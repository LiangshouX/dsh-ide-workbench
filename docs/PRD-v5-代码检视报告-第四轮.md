# PRD-v5 代码检视报告（第四轮：修复复核）

> **范围**：`59ef905` → `920dda7`（1 个提交，`fix(code): keep the host and the client on the same budget, and make the wait visible`）。
> **基线**：`59ef905`。**对照物**：`docs/PRD-v5-代码检视报告-第三轮.md`（上一轮，T1–T7）、`docs/PRD-v5-代码检视报告-第三轮-修复记录.md`（开发方的修复记录）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **716 项 / 716 通过 / 0 失败**（上一轮 698）；自建探针做**端到端跨层复验**（把宿主真实的 `processId` 喂进客户端的 store），并对新增的跨层用例做**连跑 12 次**的稳定性验证。
> **本次检视未修改任何源码**。探针脚本写在仓库外的临时目录（`%LOCALAPPDATA%\Temp\iwb-probe\`）。
> **检视日期**：2026-11-01。
> **重点关注**：① 上轮 T1–T7 的修复是否真的成立；② 开发方**没有照搬**我上轮修法的 T1 改法是否成立；③ 新增的跨层用例是否真能守住「两侧一致」。

---

## 0. 结论

### 0.1 一句话

**上轮 7 条全部修复，T1 的不对称已端到端消除。** 这一轮做对了一件比"修好"更重要的事：**把"两侧必须一致"这件事变成了一个可执行的断言**——新增的跨层用例把同一串请求同时喂给宿主和客户端，用**用户能感知的方式**读两边。我用端到端探针复验了它：**崩溃重启后两侧同时回到 10 分钟预算**。

本轮只剩 **1 条低危（测试覆盖缺口）**，其余是 2 条说明项。

### 0.2 上轮 T1–T7 的复核：**7/7 全部修复**

| 编号 | 严重度 | 上轮的结论 | 本轮复核 | 关键证据 |
|---|---|---|---|---|
| **T1** | 中 | 崩溃重启后宿主与客户端预算不一致 | ✅ **已修复（端到端实证）** | 宿主 `session.processId += 1`（`lsp.js:1643`）→ `status()` 发布（`:610`/`:712`）→ store 镜像（`store.js:1752`）→ 客户端 `watchServerProcess`（`lsp-session.js:941-975`）。**探针：崩溃重启后宿主=long、客户端=long** |
| **T2** | 低 | `session.timeouts` 跨重启继承 | ✅ 已修复 | `lsp.js:1638` `session.timeouts = 0`；探针确认重启后 `timeouts=0` |
| **T3** | 低 | 两侧对「一次回答」的认定不同 | ✅ 已修复 | 新增 `src/host/semantic-methods.js`（32 行，**单一清单**）；宿主 `semantic: SEMANTIC_METHODS.has(message.method)`（`lsp.js:1794`）、worker 上报方法名（`lsp-worker.js:429-437`）、客户端 `import { SEMANTIC_METHODS } from '../host/semantic-methods.js'`（`lsp-session.js:65`） |
| **T4** | 低 | 边界把所有 session 都降级 | ✅ 已修复 | 新增 `isLspFault(error)`（`index.js`）：只有栈指向 `host/lsp` 的故障才降级会话，终端/文件操作的故障不再带走语义分析 |
| **T5** | 低 | 接管时丢了 Node 的 `origin` | ✅ 已修复 | `listener(error, event)` 把 origin 原样交还 |
| **T6** | 低 | 「宿主先装 handler」的顺序假设 | ✅ 已修复（**超出我的建议**） | 假设被**检查**（没有可继承的处理器就告警）+ 迟到的处理器被**接管**（`adoptLateHandlers`），并诚实写明「迟到之后的第一次错误救不回来」 |
| **T7** | 说明 | 第一次补全挂 10 分钟，状态栏却说「就绪」 | ✅ **按我建议的方向处理**（不缩短等待、改为可见） | `buildingProgram` 标志（`lsp.js:614`）+ 状态栏「语义分析：正在构建索引…（首次语义请求可能需要数分钟）」（`i18n.js:1137`） |

### 0.3 验收数据核对：**逐项吻合**

| 开发方声明 | 我的实测 | 结论 |
|---|---|---|
| 自动化测试 **716 / 716 通过 / 0 失败** | `npm test` → `tests 716 / pass 716 / fail 0` | ✅ 吻合 |
| 客户端构建 **2,871,618 字节** | `dist/client.js = 2871618` | ✅ 吻合 |
| i18n en / zh-CN 各 **574 key** | 全表 1148 条目 → 两表各 574 | ✅ 吻合 |
| 跨层用例 12 次单独跑 + 6 次整包跑全绿 | 跨层用例**连跑 12 次，0 失败** | ✅ 吻合 |

### 0.4 本轮新发现（U1–U3）

| 编号 | 严重度 | 一句话 | 位置 |
|---|---|---|---|
| **U1** | 低 | **跨层用例没有覆盖「服务器被替换」这个 T1 场景本身**；「宿主发布 → store 镜像 → 客户端观察」这条链是三段单侧测试拼起来的，端到端没人守 | `tests/lsp-budget-agreement.test.mjs` |
| **U2** | 低 | 请求被看门狗计为超时后会从 `pendingRequests` 里删掉 → `buildingProgram` 变 false → 状态栏不再说「正在构建索引」 | `src/host/lsp.js:2172` |
| **U3** | 说明 | 客户端的 `lastProcessId` 是**全局**的，而 `processId` 是**按 root** 的 → 两个项目的代号可能撞车；今天无害，但这是个潜在耦合 | `lsp-session.js:149` vs `lsp.js:1461` |

**统计：低 1 / 说明 2。无中危、无高危。**

### 0.5 总体判断

**这一轮的质量明显高于前三轮**，理由有三条：

1. **他们没有照搬我的修法，而且是对的**（§1.1）。我上轮给 T1 提了两个修法：① 宿主推一条 `{type:'restarted'}` 通知；② 宿主在状态里发布进程代号。他们选了 ②，理由是「**客户端根本没有接收控制事件的通道**——中继把控制事件当普通 JSON 发到 socket 上，客户端交给库，库不认就丢弃；要接通知就得在客户端解析每一个 socket 负载，与本仓库『主线程不解析 LSP 载荷』的约定冲突」。**这条理由我复核后成立**，而且它守住了仓库里一条我自己没提但更重要的架构约定。
2. **T6 的处理超出我的建议**（§1.3）。我只说了"把顺序假设写进注释"，他们不但写进去了，还**做了检查**（没有可继承的处理器就告警）并**接管了迟到的处理器**——后者是我完全没想到的。
3. **跨层用例的思路是对的**（§1.2）。我上轮说「任何单侧用例都证明不了这件事」，他们把这句话变成了一个真实的测试。

**剩下的 U1 是个诚实的缺口**：他们新增的跨层用例覆盖了「两侧一起变耐心」「非语义回答不改变任何一侧」，但**没有覆盖"服务器被替换"**——也就是 T1 本身。而 T1 的三个部件（宿主发布代号 / store 镜像代号 / 客户端观察代号）分别由三段**单侧**测试守着，任何一段坏了都能被抓到；但**连接它们的那条链**（宿主真实 `status()` → 真实 store → 真实客户端）没有端到端用例。我用探针跑通了这条链（**它是通的**），所以这是**测试覆盖缺口，不是缺陷**。

---

## 1. 三处关键复核

### 1.1 T1：改用「进程代号」，而他们拒绝了我的修法 1——理由成立

**他们的修法**：

```
宿主：#spawn 里 session.processId += 1（lsp.js:1643）
      status() / stateOf() 把它发布出去（lsp.js:610、:712）
store：status 轮询时镜像到 state.lsp.processId（store.js:1752）
客户端：watchServerProcess(store) 在每次 store 变化时比对代号（lsp-session.js:941-975）
        代号变了 → resetForNewServer() → resetLspHealth() + applyRequestBudget()
```

**为什么不用我的修法 1（推 `{type:'restarted'}` 通知）**——他们的原话：

> *"客户端根本没有接收控制事件的通道——中继把控制事件当普通 JSON 发到 socket 上，客户端交给库，库不认就丢弃。要接通知就得在客户端解析每一个 socket 负载，与本仓库「主线程不解析 LSP 载荷」的约定冲突。"*

**我复核了这条**：`src/host/lsp-ws.js:89-92` 的 `control` 确实只是 `ws.send(JSON.stringify(event))`——**控制事件和 LSP 载荷走同一条道、同一种格式**，没有任何带外通道。而客户端的 `Transport` 把每个 socket 负载都交给 `@codemirror/lsp-client`（`lsp-session.js` 的 `createLspTransport`），库不认识的 JSON 直接丢。⇒ **要在客户端接通知，就得在客户端解析每一个 socket 负载**——那正是仓库用 `lsp-worker.js`（帧 worker）刻意避免的事。**他们的判断是对的，我的修法 1 与仓库的架构约定冲突。**

**代号方案的边界处理得比我细**（`lsp-session.js:941-975`）：

| 情形 | 处理 |
|---|---|
| 代号为 **0**（没有服务器在跑） | 复位预算——**新服务器要重新构建 program**，哪怕它还没起来 |
| **第一次**看到这个代号 | 是**基线**不是重启；**除非** `semanticAnswers > 0`（客户端已经答过话、却还没见过代号 ⇒ 那个服务器在第一次轮询前就被换掉了）→ 复位 |
| 代号**变了** | 服务器被替换 → 复位 |

第三条正是开发方在总结里点名的那个边界（「客户端已经答过话、却还没见过进程代号」），**我上轮没提，是他们的队友提的**——处理正确。

**端到端复验（我的探针 `probe-t1-fixed.mjs`）**：

```
=== 场景 1：服务器崩溃重启后，两侧预算是否都回到长预算 ===
  回答之后：宿主=short  客户端=short
  崩溃重启后：宿主 processId = 2（原 1）  宿主状态 = building
  轮询到新代号之后：宿主=long  客户端=long
  => ✅ 两侧一致，都是长预算 —— T1 已修复
```

**这与上一轮同一个场景的读数形成对照**：上一轮是「宿主=long / 客户端=short → 不一致」，现在是「宿主=long / 客户端=long → 一致」。**同一个探针、同样的驱动方式，结论翻转。**

**代号本身也不会倒退**（`lsp.js:1456-1461` 的注释）：新会话继承被替换会话的代号——

> *"the identity of a project must never go backwards (a session that is replaced after an idle exit would otherwise start again at 1, and the client - which compares the numbers - would not see the new process at all)"*

我核了唯一的 `entry.session = null`（`lsp.js:2496`）——它在**插件卸载**的拆卸函数里（紧接着 `ROOTS.clear()`），不是日常路径。✅

### 1.2 跨层用例：思路对，是这一轮最有价值的产出

我上轮的建议原文是「任何单侧用例都证明不了这件事（宿主只测宿主、客户端只测客户端）」。他们把它变成了 `tests/lsp-budget-agreement.test.mjs`（268 行）。

**它怎么做的**（我读了全文）：

- **同一串事件驱动两侧**：一个请求、一个回答，两边同时收到；
- **用用户能感知的方式读两边**：
  - 宿主 → `manager.stateOf(root).timeouts`：**这个请求有没有被记成超时**（用户看到的就是"服务器被杀"或"服务器还活着"）；
  - 客户端 → **下一个**请求拿到的 `client.timeout`（用户等的就是这个）；
- **探针方法用 `textDocument/probe`**（`:162`）——一个**非语义**的方法，所以它不会推动任何一侧的计数器，读数干净。

**两条用例**：

| 用例 | 断言 |
|---|---|
| `'the host and the client are patient in the same way'` | 回答之前两侧都是 `long`；回答之后两侧都是 `short` |
| `'an answer that is not semantic changes neither side'` | 一个 `workspace/executeCommand` 被回答后，两侧**仍然**都是 `long`（T3 的不变量） |

**第二条正是 T3 的守卫**。我上轮说 T3「目前不可达，但靠『我们不发格式化/重命名』维持着」——现在它有了一条**跨层**的断言：哪天有人接入了格式化，**两侧会同时被测试抓住**。

**flaky 的修复也是对的**：他们说根因是「客户端的 `semanticAnswers` / `lastProcessId` 是模块全局，会在同一个文件的用例之间泄漏」。我核了代码：`resetLspHealth()` 复位 `semanticAnswers` 但**不复位** `lastProcessId`；而 `configureLsp(store)`（`:1082`）会复位 `lastProcessId = null`——所以每个用例**各自 `configureLsp` + 各自的项目根 + 显式 `resetLspHealth()`**是正确组合。

**稳定性复验**：我**连跑 12 次**，每次 `pass=2 fail=0`，**0 次失败**。

### 1.3 T6：处理超出我的建议

我上轮只建议「把『宿主先装 handler』这个前提写进注释，并加一条断言/测试」。

他们做了三件事：

1. **写进注释**（`index.js`）；
2. **检查**：接管时若 `inherited.length === 0` → **告警**「no handler for %s was installed before the plugin took the event over; the host may end the process for a fault of the plugin」；
3. **接管迟到的处理器**（`adoptLateHandlers`）——这是我没想到的：

> *"Node copies the handler array before it calls the handlers, so a handler that appears later is called by Node itself — and the host's fail-loud handler would end the process even for a fault of the plugin. Such a handler is therefore adopted: it is remembered and called by this boundary, and removed from the process."*
>
> *"The one error that cannot be saved is the FIRST one after the late installation: it is already in the copy Node made."*

**第三点尤其好**：它把「接管」从一次性的快照变成了一条**持续的约定**——迟到的处理器会被收编，而不是让边界失效。而且**诚实写明了唯一救不回来的那个错误**（迟到之后的第一次，因为 Node 已经复制了数组）。这种「把边界写清楚」的注释，比沉默的防御更有价值。

**T4 / T5 也一并核过**：`isLspFault()` 用 `LSP_SOURCE = ${PLUGIN_DIR}/host/lsp` 判定来源，只有语言服务器半边的故障才降级会话；`listener(error, event)` 把 origin 原样交还。

---

## 2. 本轮新发现

### U1 ［低］跨层用例没有覆盖「服务器被替换」——也就是 T1 场景本身

**现状**：

| 环节 | 由谁守住 | 类型 |
|---|---|---|
| 宿主发布代号（`status()` 里 `processId` 随进程变） | `tests/lsp-recovery.test.mjs:98-157` | **单侧** |
| store 镜像代号 | `tests/lsp-client-budget.test.mjs:451`/`:491`（mock `status`） | **单侧** |
| 客户端观察代号并复位 | `tests/lsp-client-budget.test.mjs:339`/`:371`/`:389` | **单侧** |
| **两端接起来** | **无** | — |

**为什么这重要**：T1 就是一个**跨侧**的不对称——"宿主发布了、store 镜像了、客户端在轮询里看到了"这三件事**必须同时成立**才对。三个单侧用例各自都能绿，但**它们之间的接线**断了也能全绿。

具体地说，假设有人改了 store 的状态合并（比如某次重构把 `processId` 漏掉、或轮询的 root 与发布的 root 不一致），那么：

- 宿主的单侧用例**照样绿**（它直接读 `manager.stateOf()`）；
- 客户端的单侧用例**照样绿**（它手动 `setProcessId()`，不经过 store）；
- **跨层用例也照样绿**——因为它**从来没有替换过服务器**。

⇒ **T1 会在测试全绿的情况下复发。**

**修复方向**：在 `tests/lsp-budget-agreement.test.mjs` 里加第三条用例，**不 mock 任何一边**：

1. 起一个宿主 manager，拿到**真实的** `stateOf(root).processId`；
2. 用一个**真的** store 把它镜像进去（而不是手动 `setProcessId`）；
3. 让宿主崩溃 → 拿到新的 `processId` → 喂进 store；
4. 断言：`probeHost(...) === 'long'` **且** `probeClient() === 'long'`。

**我这次用的探针就是这个形状**（`probe-t1-fixed.mjs` 场景 1），可以直接搬进 `tests/`。

> 顺带一提：这条用例会**同时**守住 U3（下面）。

### U2 ［低］请求被计为超时后，状态栏不再说「正在构建索引」

`#checkTimeouts`（`lsp.js:2172`）在把一个请求记成超时时会把它从 `pendingRequests` 里删掉（"它只被计一次"）。而 `isBuildingProgram`（`lsp.js:565-573`）的第二个条件是「**有一个语义请求还挂着**」：

```js
if (session.realAnswers > 0) return false
for (const pending of session.pendingRequests.values()) {
  if (pending.semantic === true) return true
}
return false
```

⇒ 请求一被计数，它就不在列表里了 → `buildingProgram` 变 false → 状态栏从「正在构建索引…」退回「索引中…」，**而服务器其实还在构建 program**。

**影响很小**：走到这一步已经过了 10 分钟（长预算），客户端那边也早就超时了，用户已经看到过一次「Request timed out」。

**修复方向**（可选）：`isBuildingProgram` 用一个**独立**的标志（例如「自上次真实回答以来，曾有一个语义请求」），而不是依赖"当前还挂着"。

### U3 ［说明］客户端的 `lastProcessId` 是全局的，而 `processId` 是按 root 的

- 客户端：`let lastProcessId = null`（`lsp-session.js:149`）——**一个全局**，不按项目区分；
- 宿主：`processId: previous?.processId ?? 0`（`lsp.js:1461`）——**按 root**，每个项目的第一个进程都是 **1**。

⇒ **两个不同项目的代号可能相同**（都是 1）。切到另一个项目时，`watchServerProcess` 看到 `processId === lastProcessId` → **不触发复位**。

**今天无害**，因为项目切换本身会复位预算：`refreshLsp()` 在 `previousRoot !== root` 时调用 `resetLspHealth()`（`lsp-session.js:926` 附近），`stopLsp()`/`startLsp()` 也会。

**但这是个潜在耦合**：一旦有人把那条复位路径删掉（看起来像冗余），代号撞车就会让新项目用 30 秒预算 → T1 复发。

**修复方向**（可选）：把 `lastProcessId` 改成**按 root 记录**（`Map<root, id>`），或者把代号做成**全局单调**（宿主侧用一个全局计数器代替按 root 继承）。两者都行；前者更贴切。

---

## 3. 修复建议与顺序

| 优先级 | 条目 | 理由 |
|---|---|---|
| **P2** | **U1**（跨层用例补「服务器被替换」） | 这是**唯一一条**能让 T1 不在测试全绿的情况下复发的缺口；探针我已经写好，直接搬进 `tests/` 即可 |
| **P3** | U2（`buildingProgram` 不依赖"还挂着"） | 影响窗口只有 10 分钟之后的那一小段 |
| **P3** | U3（代号按 root 或全局单调） | 今天无害，但去掉冗余复位就会变成真问题 |

**本轮没有需要动生产代码的事项。**

### 建议补的回归测试

| 缺失覆盖 | 建议测试 |
|---|---|
| **T1 的端到端链路** | `tests/lsp-budget-agreement.test.mjs` 加第三条：真实宿主 → 真实 store → 真实客户端，崩溃重启后两侧都必须是 `long`（见 §2 U1 的四步） |

---

## 附录：本次检视的复现命令

```powershell
# 1. 全量测试（实测 716/716 通过，0 失败，约 27.8s）
cd D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\dsh-ide-workbench
npm test

# 2. 本轮探针（仓库外，只读）
cd $env:LOCALAPPDATA\Temp\iwb-probe

node probe-t1-fixed.mjs      # 端到端：崩溃重启后 宿主=long / 客户端=long（T1）
                             #   同一探针还覆盖 T3（非语义回答两侧都不变）与 T7（buildingProgram）
node probe-budget-host.mjs   # 宿主侧：崩溃重启后 timeouts 归零、预算回到 600000ms（T2）

# 3. 稳定性复验：跨层用例连跑 12 次（实测 0 失败）
cd D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT\dsh-ide-workbench
1..12 | ForEach-Object { node --test tests/lsp-budget-agreement.test.mjs }
```

**探针说明**：`probe-t1-fixed.mjs` 直接 import 生产代码（`src/host/lsp.js`、`src/client/lsp-session.js`、`src/host/lsp-frame.js`、`src/host/settings-defaults.js`），复用 `tests/lsp-fixtures.mjs` 的 `makeManager`，**把宿主真实的 `stateOf(root).processId` 喂进客户端的 store**——这是本轮最关键的一步，它把三段单侧测试接成了一条真实链路。**不修改仓库任何文件。**

> ⚠️ `src/host/lsp.js` 的 `ROOTS` 是**进程全局**的 → 每个探针必须用**独立 root**。

### 宿主重载（开发方提醒得对）

本轮修复涉及 `src/host/lsp.js`（代号发布、`timeouts` 清零、语义判定）——**宿主侧不会热更新**，必须**重启 DSH 或重载插件**，否则跑的还是旧宿主。客户端刷新页面即可。

---

## 附录二：与前几轮检视的关系

| 前几轮 | 本轮关系 | 说明 |
|---|---|---|
| **T1–T7**（上一轮） | ✅ 全部修复 | 见 §0.2。**T1 的修法他们没照搬我的，是对的**（§1.1）；**T6 的处理超出我的建议**（§1.3） |
| **S1–S9**（第三轮） | ✅ 保持修复 | 本轮未触及；`semantic-methods.js` 与 `settings-defaults.js` 一起延续了「单一事实来源」的做法——**跨宿主/客户端的判据现在有三份共享常量**：`BUILD_REQUEST_TIMEOUT_MS`、`DEFAULT_LSP_SETTINGS`、`SEMANTIC_METHODS` |
| **R1–R20**（上上轮） | ✅ 保持修复 | 未触及 |
| **N2 / M1–M3 / D1–D9** | 不重复 | 与本轮条目无关 |

**一句话总结**：前三轮是"把缺陷修掉"，这一轮是"**把'两侧必须一致'变成了一条可执行的断言**"——这正是我上轮指出的、连续两轮都暴露出来的根本问题（"任何单侧用例都证明不了这件事"）。机制上已经没有已知缺陷了，剩下的 U1 只是这条新断言自己还差一个场景。
