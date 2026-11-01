# PRD-v5 代码检视报告（第七轮：`1dbc238` 复核）

> **范围**：`8e0ed73` → `1dbc238`（1 个提交：`1dbc238`「让出口与开关列表跟真相对齐」）。
> **基线**：`8e0ed73`。**对照物**：`docs/prd/v5/PRD-v5-代码检视报告-第六轮.md`（上一轮 R6-1 – R6-6）、`docs/prd/v5/PRD-v5-改造需求-实施进展.md`（§3.13 / §6.3）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **905 项 / 905 通过 / 0 失败**（上一轮 900，+5）；`npm run build` 绿，`dist/client.js` = **3,032,497 B（2,959.1 KiB）**，重建后 `git status` 无变化 ⇒ **提交���产物与源码逐字节一致**；三个自建探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**）复验出口按钮、三档文案、设置页开关与索引策略。
> **本次检视未修改任何源码**，本文件是本轮唯一产物。
> **检视日期**：2026-11-01。
> **重点关注**：① 第六轮 6 条是否真的修好（特别是"出口跟着问题走"这个改法有没有新的副作用）；② 被改写的既有测试有没有削弱断言；③ 实施记录里 **R6-7（根因仍在）** 的记述是否准确、它遗留的边界是什么。

---

## 0. 结论

### 0.1 一句话

**上一轮 6 条全部修复，全部实证通过；本轮没有发现新的可动作缺陷。** 唯一留下一条低危：**`indexOnOpen: 'always'` 在"启动时恢复的项目"与"切换工作区"这两条路径上被忽略**——用户明说了"总是索引"，宿主却不会为那个项目起服务器。另有两条说明项观察。

本轮新发现 **1 条低危（R7-1）** + **2 条说明项（O-1 / O-2）**。**无中危、无高危。**

### 0.2 第六轮 6 条的复核：6/6 全部修复

| 编号 | 第六轮结论 | 本轮复核 | 关键证据 |
|---|---|---|---|
| **R6-1** | 【重新连接】跟着显示层让位一起消失，菜单提示仍指向它 | ✅ **已修（十一态实测）** | `showReconnectButton(viewKey, clientState)` ⇒ `viewKey === 'sessionFailed' \|\| clientState === 'failed'`（`Workbench.jsx:410`）。**探针把宿主 11 种状态 × 客户端 3 种状态全跑了一遍：客户端会话 `failed` 时，【重新连接】在 11 种宿主状态下**全部存在**，而【重新建立索引】全部不出现（两按钮仍互斥）；客户端会话 `starting`/`ready` 时【重新连接】一律不出现 ✅。提示文案三档（`lsp-session.js:1770` `semanticUnavailableFor`）：`ready`→"不支持" / `failed`→"未就绪，可在状态栏重新连接"（**按钮确实在**）/ `starting`→"正在连接…"（**不再承诺一个还不存在的按钮**） |
| **R6-2** | `605ad1d` 只覆盖已安装的被关语言 | ✅ **已修** | `mergeServerToggles` 把 `missing` 桶也并进来（`SettingsPanel.jsx:171`）。**探针**：被关掉**且未安装**的 java ⇒ `开关列表里有 java 吗 = true`，`enabled=false`，标题是宿主的安装提示 |
| **R6-3** | 设置页把被关掉的语言说成「未找到」 | ✅ **已修** | 设置页按同一把尺子过滤（`SettingsPanel.jsx:208`）。**探针**：「未找到」那一行现在只列 `go`（想要但没装），被关掉的 java 不再被算进去 |
| **R6-4** | `refreshLsp` 里那个条件是不可达分支 | ✅ **已修** | 条件简化回**无条件** `shutdownHostLsp(previousRoot)`，注释改成实话（并写明"宿主自己释放服务器"**不在**其中——因为会话压根不会因此被拆） |
| **R6-5** | 同一份状态清单写了两遍 | ✅ **已修** | 一份清单 `LSP_HOST_HEALTHY_STATES`（`lsp-session.js:115`），状态栏（`Workbench.jsx:20` 导入、`:579` 使用）与 toast 闸门（`store.js:27` 导入、`:1701` 使用）都从它取 |
| **R6-6** | 记录里的测试总数差 1 | ✅ **已修** | 实施记录 §0 与 §6.3 现为 **905**；**实测 `npm test` ⇒ 905 / 905 / 0 失败**，吻合 |

### 0.3 本轮新发现

| 编号 | 严重度 | 一句话 | 位置 |
|---|---|---|---|
| **R7-1** | **低** | **`indexOnOpen: 'always'` 在"启动恢复"与"切换工作区"两条路径上被忽略**：客户端建了会话，宿主却不会起服务器——用户明说了"总是索引" | `src/client/store.js:801` / `:1203` vs `:1305-1306` |
| **O-1** | 说明 | 同一个局面下，状态栏按钮的**身份**会在 2 分钟后从【重新建立索引】变成【重新连接】 | `Workbench.jsx:379` / `:410` |
| **O-2** | 说明 | R6-5 的回归测试是**源码文本断言**（grep），它守不住"清单被复制"这件事，却会被一次无关的重命名弄红 | `tests/client-status-render.test.mjs` |

**统计：低 1 / 说明 2。**

### 0.4 总体判断

**这一轮是七轮里改动最小、风险最低的一轮，也是我做过的最省力的一次复核**——原因不是改动小，而是**前一轮把地基打好了**：上一轮引入的"显示层闸门"是本轮所有修正的挂载点，本轮只是把出口按钮和提示文案挂到**问题**（而不是"谁赢了显示层"）上，并把同一份清单收成一份。这三处改动互相咬合，没有留下需要我去猜的地方。

两处值得记下的地方：

1. **"出口跟着问题走"这个改法是对的，而且没有副作用**。我原本担心的是：让【重新连接】在宿主 `idle` / `degraded` / `crashed` 等状态下也出现，会不会在某些状态下给出**错的动作**（比如宿主是"内存不够"降级时，重连其实也是被内存挡住的）。我逐个状态核对过：**【重新连接】做的正是【重新建立索引】做的（宿主 shutdown + 宿主 start），再加上一次客户端握手**——它是**超集**，所以在任何状态下都不比【重新建立索引】差；两个按钮互斥也不会让用户少一个出路。
2. **他把我上轮"单独记一笔"的 R6-7 记准了**。实施记录 §3.13 写的是"`lsp.start` 只在切换项目时被调用，而启动恢复路径直接 `set({ root })`，**从不走索引决策、也从不调 `lsp.start`**"——两句都对，而且**没有夸大**：本轮我逐条核对过 `call('lsp.start')` 的全部调用点（`store.js:1305`、`:1306`、`:1653`），确实只有**项目切换路径**与**按钮路径**两处。

**剩下的 R7-1 是这条根因的一个更锋利的切面**，它不是新问题（`cb37295` 即如此），但它把"没做"的那件事的**边界划清楚了**：开发方推迟的理由是"让启动恢复路径也走一次索引决策 ⇒ DSH 一启动就可能弹索引决策框"——**这条理由只对 `'ask'` 成立**；`'always'` 本来就不需要弹框。

---

## 1. 第六轮 6 条的修复复核（证据）

### 1.1 R6-1 —— 出口跟着问题走（十一态实测）

**探针输出**（`%LOCALAPPDATA%\Temp%\probe_r7.mjs`，把宿主 11 种状态 × 客户端 3 种状态全跑了一遍）：

```
  -- 客户端会话 = failed --
     宿主 idle        key=idle              重新连接=有 重新建立索引=无
     宿主 disabled    key=disabled          重新连接=有 重新建立索引=无
     宿主 degraded    key=degraded          重新连接=有 重新建立索引=无
     宿主 crashed     key=crashed           重新连接=有 重新建立索引=无
     宿主 suspended   key=suspended         重新连接=有 重新建立索引=无
     宿主 cancelled   key=cancelled         重新连接=有 重新建立索引=无
     宿主 failed      key=failed            重新连接=有 重新建立索引=无
     宿主 starting    key=sessionFailed     重新连接=有 重新建立索引=无
     宿主 building    key=sessionFailed     重新连接=有 重新建立索引=无
     宿主 ready       key=sessionFailed     重新连接=有 重新建立索引=无
     宿主 restarting  key=sessionFailed     重新连接=有 重新建立索引=无
  -- 客户端会话 = starting --
     宿主 idle        key=idle              重新连接=无  重新建立索引=有
     …（其余 10 种同样：无重新连接）
  -- 客户端会话 = ready --
     宿主 idle        key=idle              重新连接=无  重新建立索引=有
     …（其余 10 种同样：无重新连接）
```

三件事同时成立：

- **上一轮那条「提示指向一个不存在的按钮」彻底消失**——客户端会话一死，出口就在，与显示层谁赢无关；
- **两个按钮仍然互斥**，没有出现"两个按钮解决同一个问题"；
- **"死会话压过宿主"的核心不变式仍然成立**：宿主 `ready`/`building`/`starting`/`restarting` + 客户端 `failed` ⇒ `key=sessionFailed`（红色）。

**三档提示**：

```
  ready     → nav.semanticUnavailable
  failed    → nav.semanticSessionUnavailable
  starting  → nav.semanticSessionConnecting
```

`semanticUnavailableFor`（`lsp-session.js:1770`）是**唯一**的映射点，`navLabels()`（`:1790`）从它取，全仓没有第二处两档逻辑残留 ✅。

**时序核对（我额外查的）**：重连能不能真的"一步恢复"，取决于**新握手会不会先于宿主起服到达**。我核了库源码：`requestInner` 里的 `this.transport.send(...)` 是**同步**调用（`client.ts:412`），而 `disconnect()` **不关 socket**（`client.ts:304-309`，只退订 + 清 `serverCapabilities`）⇒ `reconnectLspSession()` 写入 socket 的时刻**早于** `restartLsp()` 的 IPC 往返 ⇒ 宿主先收到新握手、再收到 shutdown/start ⇒ 新进程用的是**最新**的握手 ✅。这条链路是通的。

### 1.2 R6-2 / R6-3 —— 设置页

```
=== C) 「未找到」那一行（过滤 enabled===false 之后）===  → go
=== D) 被关掉且未安装的语言（java）===
  开关列表里有 java 吗   = true
  java  enabled=false  title=Install JDK 21+ and make sure "jdtls" is on PATH.
```

**注册表里的每一种语言现在都有开关**（含没装的），而「未找到」那一行只列**想要、但这台机器上没有**的语言——与状态栏同一把尺子 ✅。

### 1.3 R6-4 / R6-5 / R6-6 —— 内部整理

- **R6-4**：`shutdownHostLsp(previousRoot)` 回到无条件；注释改成实话，并写明"宿主自己释放服务器（空闲超时）**不在**其中——会话压根不会注意到，宿主会在下一个载荷上把服务器唤醒"。
  我复核了这句话：`sessionWanted` 只看**决策**与**设置**，**不看 `store.state.lsp.state`** ⇒ 宿主释放服务器时客户端会话不会被拆 ⇒ `refreshLsp` 在 `key === sessionKey` 处直接返回 ✅。**注释是准的**。
- **R6-5**：一份清单，两个使用点都从 `lsp-session.js` 取 ✅。
- **R6-6**：**905 / 905 / 0 失败**，与记录吻合 ✅。

---

## 2. R7-1（低）——`indexOnOpen: 'always'` 在恢复路径与切工作区路径上被忽略

**一句话**：上一轮记下的 R6-7（根因仍在）有一个更锋利的切面：**恢复出来的项目**与**切换工作区后打开的项目**，即便用户把 `indexOnOpen` 设成 `'always'`（"总是索引"），宿主也**不会**为它们起语言服务器。

#### 实测（探针 `%LOCALAPPDATA%\Temp%\probe_r7_policy.mjs`，真实 store）

```
indexOnOpen=always  决策=unknown      会话=有 新socket=1
indexOnOpen=ask     决策=unknown      会话=有 新socket=1
indexOnOpen=never   决策=conservative 会话=无 新socket=0
```

⇒ `'always'` 与 `'ask'` 的**决策结果完全一样**（都是 `'unknown'`），也就是说**设置项 `'always'` 在这条路径上不起任何作用**。

#### 机理

决策与起服是**两条独立的路径**，而只有**项目切换**这一条同时跑了它们：

| 路径 | 决策 | 起服 |
|---|---|---|
| **项目切换**（`#switchProjectWithIndex`，`store.js:1297-1307`） | ✅ `#decideIndex` ⇒ `'always'` 直接给 `'build'`（`store.js:1380`） | ✅ `call('lsp.start')`（`store.js:1305-1306`） |
| **启动恢复**（`#runInit` ⇒ `this.set({root})`，`store.js:801`） | ❌ 从不调用 `#decideIndex` ⇒ 决策恒为 `'unknown'` | ❌ 从不调用 `#startLsp` |
| **切换工作区**（`setRoot` ⇒ `this.set({root})`，`store.js:1203`） | ❌ 同上 | ❌ 同上 |

`call('lsp.start')` 在整个客户端**只有三个调用点**：`store.js:1305`、`:1306`（项目切换）、`:1653`（【重新建立索引】按钮）。宿主侧 `#ensureSession` 也只有两个 API 入口（`lsp.js:1100` 的 `index()`、`:1121` 的 `start()`），而 `#requestWake` 要求**已有会话**（`lsp.js:1471`）⇒ **无会话时宿主自己不会起任何服务器**。

⇒ 结果：恢复出来的项目**客户端建了会话**（socket 开着、握手发了 4 轮），**宿主一个进程都没有**。语义功能整个会话不可用。

#### 影响

- 用户把 `indexOnOpen` 设成 `'always'`，在**切换项目**时立刻生效（不弹框、直接起），在**启动工作台**时**不生效**——同一份设置，两种行为。
- 与 `'ask'` 的差别只在于"该不该弹那个框"，而**用户已经用设置表达过意见了**（`'always'` 明确说了"总是"）。

#### 最小修复方向

**方案 A（推荐，不需要任何弹框）**：在**启动恢复**与**切工作区**这两条路径上，**只对 `indexOnOpen === 'always'`（以及记住的内存答复是 `'accepted'`）的项目**补一次 `#startLsp`——`'ask'` 维持现状（不弹框、不起），`'never'` 本来就不起。

```js
// store.js 的 #runInit / setRoot 两处，设完 root 之后
if ((this.state.settings?.lsp?.indexOnOpen ?? 'ask') === 'always') {
  void this.#startLsp(projectRoot)
}
```

（**注意**：`#startLsp` 走的是宿主自己的内存闸门 ⇒ 机器内存不够时它会降级，不会硬起 ✅。）

**方案 B（超出本轮，需产品决定）**：让启动恢复路径也走一次索引决策 ⇒ 可能一启动就弹框——**这是开发方推迟的理由，这条理由只对 `'ask'` 成立**。

> 我建议 **A**：它不动 `'ask'` 的语义（不弹框），却让用户明确表达过的 `'always'` 真正生效；成本是恢复路径上多一次 `lsp.start` 调用。

---

## 3. 说明项观察

### 3.1 O-1 —— 状态栏按钮的身份会随会话状态翻转

同一个局面（宿主 `idle`、没有服务器）：

| 时刻 | 客户端会话 | 状态栏文案 | 按钮 |
|---|---|---|---|
| 打开项目后的前 ~2 分钟 | `starting` | 「语义分析：未启用（无语言服务器）」 | **【重新建立索引】** |
| 约 2 分钟后（重试耗尽） | `failed` | 「语义分析：未启用（无语言服务器）」 | **【重新连接】** |

两个按钮**都能起服务器**（【重新连接】多做一次握手），所以功能上没问题；动词的切换也说得通（会话死了 ⇒ "重连"比"重建"准）。但**同一个局面下按钮在用户眼前换了个名字**，而且切换的触发点是"客户端重试耗尽"这个**内部计时**，用户无从预期。

**建议**：要么让【重新连接】从会话一开始不可用时就存在（把 `clientState === 'starting'` 也算进去？但那时"重连"还不是准确的说法），要么在按钮上加一句说明。**这属于打磨，不是缺陷**，记一笔备查。

### 3.2 O-2 —— R6-5 的回归测试守不住它想守的东西

新增的 `tests/client-status-render.test.mjs`「the status bar and the toast share one list of the healthy host states」是**源码文本断言**：

```js
assert.match(source, /import \{ LSP_HOST_HEALTHY_STATES \} from '\.\/lsp-session\.js'/, …)
assert.doesNotMatch(source, /const HOST_HEALTHY_STATES/, …)
```

- **假红**：把 import 改成 `import * as lsp from './lsp-session.js'`（或换个行内格式）就变红，而行为一点没变。
- **假绿**：把清单复制回第二个文件、只要**常量名**不是 `HOST_HEALTHY_STATES`（例如叫 `HEALTHY`），这个断言照样通过——**它想守的"只有一份"没守住**。

**建议**：改成**行为断言**——要么断言两个模块导出的是**同一个数组对象**（`assert.equal(storeModule.LSP_HOST_HEALTHY_STATES, workbenchModule.LSP_HOST_HEALTHY_STATES)`），要么（更好）断言**两者在全部宿主状态上给出相同答案**：对 11 种宿主状态各跑一次"状态栏 key"与"toast 闸门"，断言两者一致。这才是"两份清单不会打架"这件事本身。

> 注：这一条**不影响本轮的结论**——清单现在确实只有一份（我已用 grep 核实全仓只有 `lsp-session.js:115` 一处定义）。它守的是**未来**。

---

## 4. 这一轮做得好、值得保留的地方

1. **"出口跟着问题走"是这一轮的关键判断，且判断正确**（§1.1）。把按钮挂在**问题**（会话死了）上而不是**显示层的输赢**上，是对的抽象；上一轮那个"提示指向不存在的按钮"的缺陷，根子就在这里。
2. **两个按钮互斥的理由写清楚了**："【重新连接】做的**就是**【重新建立索引】做的，再加一次握手——给用户两个按钮解决同一个问题是噪音，而且先给出弱的那个"。这是**面向用户的判断**，不是代码洁癖。
3. **提示文案分三档，而不是改一个字**。`'starting'` 单独一档是这一轮我没想到的：我上轮只要求"别承诺不存在的按钮"，他进一步把"正在连接"这个**第三种真实状态**单独表达了出来。
4. **R6-7 记准了，没有夸大，也没有回避**。实施记录 §3.13 把它写成"复核建议，未列为条目"，并把"没做"的理由（会弹框）与"没做"的边界（超出本轮、需产品决定）都写下来了。**我复核后确认：这两句都准确**（§0.4 第 2 条）。
5. **既有的那条测试被改写时，断言形状没变、只改了事实**，并写明了为什么变（`tests/lsp-status-freshness.test.mjs`：「the session is still connecting: there is no button to promise yet」）。这是历轮一致的处置方式。
6. **提交里的产物与源码逐字节一致**（重建后 `git status` 无变化）——对一个把 `dist/` 提交进仓库的项目，这条不是小事。

---

## 5. 复现方法与探针说明

本轮三个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `probe_r7.mjs` | R6-1 / R6-2 / R6-3 | 宿主 11 态 × 客户端 3 态的按钮矩阵；三档提示；设置页开关列表 |
| `probe_r7_policy.mjs` | **R7-1** | `indexOnOpen` 三种取值的决策与会话结果 |
| `probe_handshake.mjs`（沿用） | P1-1 回归 | 新进程的 `rootUri` 仍是 `file:///NEW-SCOPE`（上一轮修复未回退） |

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -6
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 8e0ed73 1dbc238 --stat

# 测试与构建（905 / 905；产物与源码一致）
npm --prefix dsh-ide-workbench test
npm --prefix dsh-ide-workbench run build
git -C dsh-ide-workbench status --short      # 重建后应当没有 dist 的改动

# 探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\probe_r7.mjs"
node "$env:TEMP\probe_r7_policy.mjs"
node "$env:TEMP\probe_handshake.mjs"
```

---

## 6. 一句话总结

**第六轮 6 条全部修好，全部实证通过；本轮没有新的可动作缺陷。** 唯一留下一条低危：**`indexOnOpen: 'always'` 在"启动恢复"与"切工作区"两条路径上被忽略**（R7-1）——它不是新问题，是 R6-7 根因的一个更锋利的切面，而开发方推迟修复的理由（"会弹框"）**只对 `'ask'` 成立**，对 `'always'` 不成立。另有两条说明项观察（按钮身份翻转、R6-5 的 grep 测试守不住它想守的东西）。
