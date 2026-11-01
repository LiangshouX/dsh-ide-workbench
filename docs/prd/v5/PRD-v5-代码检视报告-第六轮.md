# PRD-v5 代码检视报告（第六轮：`605ad1d` + `8e0ed73` 复核）

> **范围**：`4b8af00` → `8e0ed73`（2 个提交：`605ad1d`「被关掉的语言服务器还能再被打开」/ `8e0ed73`「让作用域收敛并停止误报」）。
> **基线**：`4b8af00`。**对照物**：`docs/prd/v5/PRD-v5-改造需求.md`、`docs/prd/v5/PRD-v5-改造需求-实施进展.md`（§3.12 / §6.2）、`docs/prd/v5/PRD-v5-代码检视报告-第五轮.md`（上一轮 P1-1 – P3-5）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **900 项 / 900 通过 / 0 失败**（上一轮 864，+36）；四个自建探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**）分别复验 P1-1 / P1-2 / 状态栏七态 / 设置页开关；本轮全部行号在 `8e0ed73`（源码工作树干净）上逐条复核过。
> **本次检视未修改任何源码**，本文件是本轮唯一产物。
> **检视日期**：2026-11-01。
> **重点关注**：① 上一轮 5 条的修复是否真的成立；② 开发方新点名的「**P1-2 比报告说的更宽：还盖住了『启动时恢复的项目』**」这一类，处置是否到位；③ 新引入的两条路径（宿主状态的显示层闸门、设置页的开关合并）有没有带来新的用户可见缺口。

---

## 0. 结论

### 0.1 一句话

**上一轮 5 条全部修复，修法都对，且这次连"误报的来源"和"误报的表现"分开处理了——这是我上一轮建议的方向。但"会话死了"让位给宿主之后，【重新连接】按钮跟着一起消失了，而菜单提示仍然让用户"在状态栏重新连接"——指向一个不存在的按钮。** 另有 1 条低危覆盖缺口（`605ad1d` 对"被关掉**且未安装**"的语言无效）与 4 条说明项。

本轮新发现 **6 条**：**1 条低危（R6-1）**、**1 条低危（R6-2）**、**4 条说明项（R6-3 – R6-6）**。无中危、无高危。

### 0.2 上一轮 5 条的复核：5/5 全部修复，且**修得比我建议的更好**

| 编号 | 上一轮结论 | 本轮复核 | 关键证据 |
|---|---|---|---|
| **P1-1** | 作用域只在「服务器不在」时收敛 | ✅ **已修（端到端实证）** | 宿主 `relayToServer` 在交给 worker **之前**记下握手（`lsp.js:1442` `if (isInitializeRequest(text)) entry.handshake = text`）；worker 的 `{type:'handshake'}` 只在 `entry.handshake` **还是空**时填（`lsp.js:2565`），迟到的旧消息不会覆盖新握手。**探针：新进程收到的 `initialize` 的 `rootUri` 现在是 `file:///NEW-SCOPE`**（上一轮是 `OLD-SCOPE`） |
| **P1-2** | 「从不索引」的项目约 2 分钟后变红；出口按钮会启动用户拒绝的服务器 | ✅ **已修（两层）** | ① store 拥有决策（`store.js:1432` `lspIndexDecision`）；② 会话跟着决策走（`lsp-session.js:1044` `sessionWanted`）⇒ **基础模式的项目根本没有会话**（实测：无客户端、无 socket）；③ 显示层只在宿主**声称没事**时让「会话死了」压过去（`Workbench.jsx:456` `HOST_HEALTHY_STATES` / `store.js:489` `LSP_HOST_FINE_STATES`）。**探针：`indexOnOpen: 'never'` ⇒ `lspIndexDecision = conservative`，会话对象 = null，新开 socket = 0** |
| **P2-3** | 【重新建立索引】跳过整道闸门（含硬下限） | ✅ **已修（三处统一）** | `#startSession`（`lsp.js:2165-2180`）、崩溃重启闸门（`:3217-3232`）、`#restart`（`:3248-3262`）统一为：**快照永远取 / 硬下限永远拒绝 / tight 档只在没有 force 时拒绝**。新增 4 条用例（硬下限之下被拒、tight 档放行、崩溃重启同样遵守硬下限、崩溃重启在 tight 档放行） |
| **P3-4** | 宿主说 `building` 时「正在连接…」不可见 | ✅ **已修** | `HOST_CONNECTING_STATES = ['ready','building']`（`Workbench.jsx:465`）；宿主自己的文案与等待时长进 **tooltip**；`starting`/`restarting` 不动（规格 §2.4 的「已等待 2 分 14 秒」不能被吞）。**连带修好**：【取消索引】改用**宿主状态**判断（`Workbench.jsx:724` `showCancelButton(lsp.state, …)`） |
| **P3-5** | `semanticNote` 的英文兜底是死代码 | ✅ **已修** | 兜底删掉（`CodeEditor.jsx:883`），并在 `labels` 合并处写明 `semanticUnavailable` **故意不被 prop 覆盖**（`:878`） |

### 0.3 开发方新点名的「启动时恢复的项目」——**处置成立，但只治了症状**

> 实施进展 §3.12：「**复核没点名、却更常见的一类**：**启动时恢复的项目**（没有任何决策）同样会这样——约两分钟后变红。这说明缺陷不在某一条策略上，而在「客户端会话没有问过 store」。」

**这句话是对的，而且它指向的东西比我的报告更准。** 我核对下来：

| 层面 | 状态 | 证据 |
|---|---|---|
| **误报消失**（状态栏不再变红、toast 不再弹） | ✅ 已治 | 宿主对无会话的 root 报 `idle`（`lsp.js:1317` `stateOf` → `state: 'idle'`；`snapshotOf` 同理 `lsp.js:898`）⇒ `idle` 不在 `HOST_HEALTHY_STATES` 里 ⇒ 宿主的话生效。**探针七态实测**：`idle` → key=`idle`、tone=`idle`、**不红**；toast 也不弹（`store.js:1713` 的闸门） |
| **误报的来源**（客户端为"宿主永远不会有服务器"的项目建会话） | ⚠️ **仍在**，但只在"本次会话没做过决策"时 | 决策为 `'unknown'` 时**照旧建会话**——这是**对的**（客户端本来就先于宿主起服务器提问，用宿主的此刻状态当前提会误伤正常路径）。实测：启动恢复场景下 `lspIndexDecision = 'unknown'` ⇒ 会话建立、socket = 1 |
| **根因**（启动恢复的项目**永远不会有服务器**） | ⚠️ **仍在**，且**不是本轮引入** | `lsp.start` 是宿主唯一的起服入口，客户端只在 `#switchProjectWithIndex` 里调用它（`store.js:1317-1318`）；而**启动恢复路径直接 `set({root})`**（`store.js:813`），**从不走索引决策、也从不调 `lsp.start`**。宿主侧 `#requestWake` 要求已有会话（`lsp.js:1471`），无会话时什么也起不来 |

⇒ **「启动时恢复的项目」这个场景，误报确实没了，但"语义功能整个会话都不可用、且状态栏说的是『未启用（无语言服务器）』"这件底层事实没变**——那句文案听起来像**配置**，而真相是**工作台从没为这个恢复出来的项目问过要不要索引**。这不是本轮的回归（我核对到 `cb37295` 就是这样：启动路径从不调 `lsp.start`，`relayToServer` 无会话时也只 `#holdFor` 不起服），但它是**这一类误报之所以更常见的原因**，值得单独记一笔（§2.1）。

### 0.4 本轮新发现

| 编号 | 严重度 | 一句话 | 位置 |
|---|---|---|---|
| **R6-1** | **低** | **「会话死了」让位给宿主之后，【重新连接】按钮跟着消失了，而灰色菜单的提示仍然写着"可在状态栏重新连接"**——指向一个不存在的按钮 | `src/client/Workbench.jsx:390` `showReconnectButton` vs `src/client/lsp-session.js:1751` `navLabels` |
| **R6-2** | **低** | `605ad1d` 只覆盖了**已安装**的被关语言：被关掉**且未安装**的语言落在 `missing` 桶 ⇒ **不在开关列表里 ⇒ 仍然开不回来** | `src/client/SettingsPanel.jsx:165` `mergeServerToggles` |
| **R6-3** | 说明 | 设置页的「未找到的语言服务器」这一行**不过滤** `enabled` ⇒ 被用户主动关掉的语言仍被报成"未找到"（状态栏过滤了，设置页没过滤） | `src/client/SettingsPanel.jsx:191` |
| **R6-4** | 说明 | `refreshLsp` 里新增的 `shutdownHostLsp` 条件是**不可达分支**，注释描述的"宿主释放了服务器"那一情形结构上不可能发生 | `src/client/lsp-session.js:1563-1566` |
| **R6-5** | 说明 | 同一份"宿主声称没事"的状态清单在**两个文件里各写了一份**，名字还不一样 | `Workbench.jsx:456` / `store.js:489` |
| **R6-6** | 说明 | 实施记录写的测试总数 **899**，实测 **900** | `PRD-v5-改造需求-实施进展.md:19` 与 §6.2 |

**统计：低 2 / 说明 4。无中危、无高危。**

### 0.5 总体判断

**这一轮的工程质量是六轮里最高的一轮**，有三条理由：

1. **它把"误报的来源"和"误报的表现"分开治了**（§0.2 的 P1-2 三层）。上一轮我提的方案 A/B/C 是在"决策层"打补丁，显示层只做兜底；他们反过来——**决策层收窄到"用户明确拒绝"这一类，其余全交给显示层**，并且在 §3.12 里写明了"为什么第 2 条不解决全部"。这个分工是对的。
2. **它自己发现了比我的报告更宽的一类**（启动时恢复的项目），并且没有把它当成"我的报告写错了"来回避，而是把它写进了 §3.12 并归因到"客户端会话没有问过 store"。**这正是我上一轮报告 §1.2 的那句话**（"缺陷不在某一条策略上，而在客户端会话没有问过 store"）——他把它说清楚了。
3. **两条记录旧行为的既有测试被"改写成新事实"而不是删掉**（`tests/lsp-memory-policy.test.mjs` 的两条：`a forced start ignores the hard floor as well` → 改成"硬下限永远拒绝"；断言没有削弱，只是把事实换成了新事实）。这是对的处置方式：**改写事实、保留断言形状**，比删测试或削弱断言都好。

**剩下的问题都是"边界没有对齐"型**，不是设计错误：

- R6-1 是**显示层闸门的副作用**：把"会话死了"让位给宿主是对的，但**让位时把出口按钮一起让掉了**，而指向出口的文案没跟着改。
- R6-2 是 `605ad1d` 的**覆盖缺口**：被关掉**且未安装**的语言走的是另一个桶。

---

## 1. 上一轮 5 条的修复复核（证据）

### 1.1 P1-1 —— 作用域真的收敛了（端到端实证）

**修法**（`src/host/lsp.js`）：

```js
// relayToServer，把载荷交给 worker 之前
if (isInitializeRequest(text)) entry.handshake = text
session.worker.postMessage({ type: 'send', text, origin: 'client' })
```

```js
// worker 的 {type:'handshake'} 消息：只在空的时候填
if (typeof message.text === 'string' && message.text !== '' && entry.handshake === '') {
  entry.handshake = message.text
}
```

第二条守卫（`entry.handshake === ''`）是我上一轮没提、但**必须加**的：worker 那条消息是**异步**的，可能在宿主已经记下更新的握手**之后**才到，迟到的旧文本不能覆盖新的。没有它，第一条修复会引入一个新的竞态。

**实测**（探针 `%LOCALAPPDATA%\Temp\probe_handshake.mjs`，同一脚本、同一场景，与上一轮逐字对比）：

```
上一轮（4b8af00）：新进程收到的 initialize: {... "rootUri":"file:///OLD-SCOPE" ...}
                   contains NEW-SCOPE: false   contains OLD-SCOPE: true
本轮（8e0ed73）：新进程收到的 initialize: {... "rootUri":"file:///NEW-SCOPE" ...}
                   contains NEW-SCOPE: true    contains OLD-SCOPE: false
```

**回归测试**（新增 `tests/lsp-handshake-scope.test.mjs`，3 例）覆盖了我上一轮指出的那条**缺失的路径**（服务器在跑时到达的握手 + 崩溃重启）与**迟到的 worker 消息**这个竞态 —— 这两条正是我上一轮说"测试与生产路径错位"的地方。**补得准。**

### 1.2 P1-2 —— 误报消失，出口不再背着用户起服务器

**实测**（探针 `%LOCALAPPDATA%\Temp\probe_r6.mjs`，**用真实的 `WorkbenchStore`**，不是测试替身）：

```
=== A) 客户端会话决策（真实 store）===
  indexOnOpen=never（用户选择从不索引）
    lspIndexDecision(root) = conservative
    客户端会话对象存在 = false | 新开的 socket 数 = 0
  indexOnOpen=ask，启动恢复（本次会话无决策）
    lspIndexDecision(root) = unknown
    客户端会话对象存在 = true | 新开的 socket 数 = 1
```

第一行是我上一轮 P1-2 的核心诉求：**基础模式的项目根本没有会话**（没有客户端、没有 socket、没有握手）。第二行是开发方主动说明的取舍：**'unknown' 照旧建会话**（客户端先于宿主提问，用宿主的此刻状态当前提会误伤正常路径）——**这个取舍我复核后成立**。

**状态栏七态实测**（同一探针）：

```
宿主 idle（无服务器）+ 客户端 failed  → key=idle      tone=idle   重新连接按钮=false  重新建立索引按钮=true
宿主 suspended（已释放）+ 客户端 failed → key=suspended tone=idle  重新连接按钮=false  重新建立索引按钮=true
宿主 crashed + 客户端 failed          → key=crashed   tone=error  重新连接按钮=false  重新建立索引按钮=false
宿主 ready + 客户端 failed            → key=sessionFailed tone=error 重新连接按钮=true  重新建立索引按钮=false
宿主 building + 客户端 failed         → key=sessionFailed tone=error 重新连接按钮=true  重新建立索引按钮=false
宿主 ready + 客户端 starting          → key=sessionConnecting tone=idle
宿主 building + 客户端 starting       → key=sessionConnecting tone=idle
```

第 4、5 行说明**上一轮的核心不变式保住了**（宿主说"就绪/构建中"而会话已死 ⇒ 红色 + 【重新连接】）。第 1、2 行说明**误报确实没了**。

**【重新连接】不再起用户拒绝的服务器**：`store.js:1748` `if (this.lspIndexDecision(this.state.root) === 'conservative') return` + `lsp-session.js:1338` 的客户端侧对称守卫。两层都有。

### 1.3 P2-3 —— 硬下限不再被 force 绕过

三处统一为「快照永远取 / 硬下限永远拒绝 / tight 档只在没有 force 时拒绝」（`lsp.js:2165-2180`、`:3217-3232`、`:3248-3262`）。**新增 4 条用例**，其中「a forced session is not restarted below the hard floor」覆盖了**崩溃重启**那一条我上一轮没单独点名的路径 —— 这是补得准的一处。

### 1.4 P3-4 / P3-5 —— 都已修，且 P3-4 连带修好了一个我没想到的连带问题

P3-4 的连带修复值得单独说一句：**【取消索引】的判断改用宿主的状态**（`Workbench.jsx:724`）。上一轮我建议放宽 `HOST_CONNECTING_STATES` 时**没想到**这会连带把【取消索引】吞掉（状态栏的 key 变成了 `sessionConnecting`，而 `showCancelButton` 原来吃的是 key）。他们发现了并修了。

---

## 2. 本轮新发现

### 2.1 R6-1（低）——【重新连接】按钮消失了，但菜单提示仍然让用户去点它

**一句话**：本轮把"客户端会话死了"改成**只在宿主声称没事时才压过去**——这是对的。但**让位的同时，【重新连接】按钮也跟着让掉了**（因为它挂在 `view.key === 'sessionFailed'` 上），而**灰色菜单的提示文案没有跟着改**：它仍然写着"可在状态栏重新连接"。

#### 机理

```js
// src/client/Workbench.jsx:390
export function showReconnectButton(viewKey) {
  return viewKey === 'sessionFailed'
}
```

`view.key` 只在 `clientState === 'failed' && HOST_HEALTHY_STATES.includes(current)` 时才是 `'sessionFailed'`（`Workbench.jsx:569`）。于是宿主在 `idle` / `disabled` / `degraded` / `crashed` / `suspended` / `cancelled` / `failed` 时，**【重新连接】一律不出现**。

而菜单提示走的是**另一条路**：

```js
// src/client/lsp-session.js:1751
export function navLabels() {
  const unavailable = clientSessionState === 'ready'
    ? translate('nav.semanticUnavailable')
    : translate('nav.semanticSessionUnavailable')   // ← 「…可在状态栏重新连接。」
```

`nav.semanticSessionUnavailable`（`i18n.js:636` / `:1269`）= "The semantic analysis session is not ready. **Reconnect it from the status bar.**" / "语义分析会话尚未就绪，**可在状态栏重新连接**。"

只要客户端会话不是 `'ready'`，这条文案就出现；而菜单项在该状态下是**灰的**（`semanticStateAllowed` 只放行 `'ready'` 与 `'suspended'`，`lsp-session.js:897`），所以 tooltip 一定被显示。

⇒ **提示指向的按钮，在七个宿主状态下不存在。**

#### 实测

探针输出（上表）已经给出：`idle` / `suspended` / `crashed` ⇒ `重新连接按钮=false`；同时探针最后一行：

```
=== 菜单提示文案（客户端会话非 ready 时）===
  navLabels().semanticUnavailable = "nav.semanticSessionUnavailable"
```

#### 用户看到的样子

最常见的形态就是**开发方自己点名的那一类**（启动时恢复的项目）：

1. 打开工作台 ⇒ 恢复出上次的项目；
2. 状态栏：**"语义分析：未启用（无语言服务器）"**，旁边一个【重新建立索引】；
3. 右键菜单里「跳转定义 / 查找引用」是**灰的**，鼠标悬上去提示：**"语义分析会话尚未就绪，可在状态栏重新连接。"**；
4. 用户去状态栏找那个"重新连接"——**没有这个按钮**。

**出路还是有的**（点【重新建立索引】→ 宿主起服务器 → 状态变成 `starting`/`building` ⇒ 红色 + 【重新连接】出现 ⇒ 点它恢复），但这是**两步**，而提示承诺的是**一步**。

#### 最小修复方向

**方案 A（推荐）**：让【重新连接】的判断**不再挂在状态栏的 key 上**，而是挂在**"客户端会话已死"这个事实上**——按钮本来就是为"会话死了"准备的出口，不该跟着"谁赢"一起变：

```js
// src/client/Workbench.jsx
export function showReconnectButton(viewKey, clientState) {
  return viewKey === 'sessionFailed' || clientState === 'failed'
}
```

（`LspStatus` 里改成 `showReconnectButton(view.key, lsp.clientState)`。这样宿主 `idle` 时也给出【重新连接】，而它做的正是"重做握手 + 重启宿主" —— 对 `idle` 来说这恰好是对的，因为**那个项目本来就没有服务器**。）

**方案 B**：把提示文案分三档——会话死了（可重连）/ 宿主没有服务器（没有可重连的东西）/ 宿主知道原因（看状态栏）—— 也就是把 `nav.semanticSessionUnavailable` 的适用范围收窄到"宿主声称没事"的那几种。

> 我建议 **A**：出口按钮应该跟着**问题**走，而不是跟着**谁赢了显示层**走。

### 2.2 R6-2（低）—— `605ad1d` 对"被关掉**且未安装**"的语言无效

**一句话**：`605ad1d` 的目标是"取消勾选的语言还能再勾回去"。但它只在**已安装**的语言上成立：被关掉**且未安装**的语言落在 `missing` 桶，而 `mergeServerToggles` **只合并 `available` 与旧的 `disabled` 桶**，不合并 `missing` ⇒ 它**不在开关列表里** ⇒ 用户**仍然开不回来**。

#### 实测（探针 `%LOCALAPPDATA%\Temp\probe_r6_settings.mjs`）

```
=== D) 被关掉且未安装的语言（java）===
  available 里有 java 吗 = false
  missing 里有 java 吗   = true | enabled = false
  开关列表里有 java 吗   = false
  开关列表: typescript(false), javascript(true), python(true), yaml(true)
```

（对照组：被关掉**且已安装**的 typescript ⇒ `available` 里 `enabled=false` ⇒ **在开关列表里** ✅，`605ad1d` 的主路径是好的。）

#### 影响

比"开不回来"更实际的一点：**设置项 `lsp.servers[languageId].enabled` 是用户能写进设置文件的**——用户完全可能先关掉 Java（因为没装），等装好 JDK 之后想打开。此时设置页里**没有这一行**，用户只能去改设置文件。

#### 最小修复方向

`mergeServerToggles` 把 `missing` 也合并进来（带 `enabled: false`）：

```js
// src/client/SettingsPanel.jsx:165
export function mergeServerToggles(servers) {
  const available = Array.isArray(servers?.available) ? servers.available : []
  const legacy = Array.isArray(servers?.disabled) ? servers.disabled : []
  const missing = Array.isArray(servers?.missing) ? servers.missing : []
  …
  for (const server of missing) add(server, server?.enabled !== false)
  …
}
```

（宿主那一侧不用改：`missing` 已经带了 `enabled`。）

### 2.3 R6-3（说明）—— 设置页的「未找到的语言服务器」把被关掉的语言也算进去

**一句话**：CHANGELOG 写的是"**状态栏不再把被关掉的语言说成『未安装』**"——状态栏确实过滤了（`Workbench.jsx:543` `entry.enabled !== false`），但**设置页那一行没有过滤**（`SettingsPanel.jsx:191` `missingServers` 原样使用）。

实测（同一探针的 D 段）：

```
  「未找到」这一行会显示: java (jdtls), go (gopls), rust (rust-analyzer), cpp (clangd)
  → 被关掉的 java 被算作「未找到」吗 = true
```

同一个词在两个界面上含义不同：**状态栏说"这不是未安装，是被关掉了"，设置页说"未找到"**。CHANGELOG 里那句"『未找到的语言服务器』（没装）留着 —— 那是机器的事实，不是设置"在这条上就自相矛盾了：被用户关掉的语言，它的"没装"也是机器的事实，但它被关掉是**设置**。

**最小修复方向**：设置页那一行同样按 `enabled !== false` 过滤（或按 `enabled` 分成两行）。

### 2.4 R6-4（说明）—— `refreshLsp` 里新增的 `shutdownHostLsp` 条件是不可达分支

**一句话**：本轮给"结束会话"加了一个条件，注释说"**唯一一种服务器会留下的情形**：会话是因为**宿主释放了服务器**而结束的"。但那一情形**结构上不可能发生**——会话的生命周期**根本不看宿主的状态**。

```js
// src/client/lsp-session.js:1563
if (previousRoot !== root || !enabled || decision === 'conservative') {
  shutdownHostLsp(previousRoot)
}
```

**为什么不可达**（穷举）——这个分支只在 `wanted === false && hadClient` 时进入，而

```
wanted = sessionWanted(store, root)
       = sessionEnabled && lspSettings.enabled !== false && root !== '' && decision !== 'conservative'
```

于是 `wanted === false` 只可能是四种情形，逐一代入这个条件：

| `wanted === false` 的原因 | 条件里的哪一项为真 | 结果 |
|---|---|---|
| `sessionEnabled === false` | `!enabled`（`enabled = sessionEnabled && …`） | **shutdown** |
| `lspSettings.enabled === false` | `!enabled` | **shutdown** |
| `root === ''`（项目被关掉） | `previousRoot !== root`（有客户端时 `previousRoot` 必非空） | **shutdown** |
| `decision === 'conservative'` | `decision === 'conservative'` | **shutdown** |

⇒ **四种情形全部走 shutdown** ⇒ 这个条件恒为真 ⇒ 它与改动前的无条件 `shutdownHostLsp(previousRoot)` **行为完全相同**，是**死代码**。

而注释描述的情形（"宿主释放了服务器 ⇒ 会话被放弃"）之所以不可能，是因为：`sessionWanted` 只看**决策**与**设置**，**不看 `store.state.lsp.state`** ⇒ 宿主把服务器释放掉（`'suspended'`）时，客户端会话**根本不会被拆**，`refreshLsp` 甚至会在 `key === sessionKey` 处直接返回。

**影响**：不是功能缺陷，是**误导性注释 + 死复杂度**。它会让后来的读者以为"宿主释放服务器"这条路径被处理过了——而它其实从未成为一条路径。

**最小修复方向**：要么把条件简化回无条件 `shutdownHostLsp(previousRoot)` 并把注释改成实话，要么把意图落成代码（若真要"宿主释放时不关服务器"，那条件应当是**看 `store.state.lsp.state`** 的）。

### 2.5 R6-5（说明）—— 同一份状态清单在两个文件里各写了一份

```js
// src/client/Workbench.jsx:456
const HOST_HEALTHY_STATES = ['starting', 'building', 'ready', 'restarting']
// src/client/store.js:489
const LSP_HOST_FINE_STATES = ['starting', 'building', 'ready', 'restarting']
```

同一份清单、两个名字、两个文件、两处用途（状态栏显示 vs toast 闸门）。**两份只要有一份漏改，toast 与状态栏就会互相打架**——而这两个正是本轮 P1-2 的两根支柱。

**最小修复方向**：抽成一份共享常量（`src/client/lsp-session.js` 或新的 `src/client/lsp-states.js`），两边都从它取。

### 2.6 R6-6（说明）—— 实施记录里的测试总数差一个

- 实施进展 `:19` 与 §6.2 写的是 **899 项 / 899 通过 / 0 失败**；
- 本轮实测 `npm test` ⇒ **900 项 / 900 通过 / 0 失败**（`1..900`，`pass 900`，`fail 0`）。

§6.2 里的"本轮开始时 870"是对的（`4b8af00` 是 864，`605ad1d` 加了 6 条）。只有最终数字差 1。

---

## 3. 对实施记录与 PRD 表述的更正建议

| # | 文件:行 | 现文 | 建议 |
|---|---|---|---|
| 1 | `PRD-v5-改造需求-实施进展.md:19` / §6.2 | 「899 项 / 899 通过 / 0 失败」 | 改为 **900** |
| 2 | `PRD-v5-改造需求-实施进展.md` §3.12（P1-2 修法第 3 条） | 「`idle` / `disabled` 意味着**根本没有服务器**，没有人可以失败；`degraded` / `crashed` / `suspended` 则是**宿主自己知道原因**，它的话更有用」 | 补一句：**这七种状态下【重新连接】按钮也不再出现**，而菜单提示仍然让用户"在状态栏重新连接"（见 R6-1）——要么补出口，要么改文案 |
| 3 | 同上 §3.12（P1-2 修法第 2 条） | 「决策是 `'unknown'`（本次会话没决定）时**照旧建会话**」 | 补一句**代价**：启动恢复的项目仍然会建会话并**重试 4 轮 × 30 s**，而宿主**永远不会**为它起服务器（`lsp.start` 只在切换项目时调用）⇒ 语义功能整个会话不可用。这不是本轮引入的（`cb37295` 即如此），但它是这一类误报更常见的原因 |
| 4 | `src/client/lsp-session.js:1557-1561`（注释） | 「唯一一种服务器会留下的情形：会话是因为**宿主释放了服务器**而结束的」 | 删掉或改成实话（该分支不可达，见 R6-4） |
| 5 | `CHANGELOG.md`「设置页：一个开关就够了」 | 「**状态栏不再把被关掉的语言说成『未安装』**」 | 补一句：**设置页的「未找到」那一行仍然会**（见 R6-3）；并说明**被关掉且未安装**的语言仍开不回来（见 R6-2） |

---

## 4. 这一轮做得好、值得保留的地方

1. **"来源"与"表现"分开治**（§0.5 第 1 条）。决策层收窄到"用户明确拒绝"这一类，其余交给显示层——这个分工比我在上一轮报告里建议的更清楚，§3.12 还写明了"为什么第 2 条不解决全部"。
2. **自己发现了比我的报告更宽的一类**（启动时恢复的项目），并归因到"客户端会话没有问过 store"——这句话正是我上一轮 §1.2 的原话，他说得更准确。
3. **迟到的 worker 消息守卫**（`entry.handshake === ''`）是我上一轮**没提**的（我提的是宿主侧那 1 行）。他不仅修了，还补上了异步竞态——**这一步是我漏掉的**。
4. **【取消索引】改用宿主状态判断**（R6-1 的对称面）是我建议放宽 `building` 分支时**没想到的连带影响**，他发现了并修了。
5. **既有测试被"改写成新事实"而不是删掉**（`tests/lsp-memory-policy.test.mjs` 的两条），断言形状保留、事实更新——这是处置"测试记录了旧行为"的正确方式。
6. **P2-3 的三处统一**（启动 / 崩溃重启 / `#restart`）一次做完，而不是只补我点名的那一处；并补了"崩溃重启同样遵守硬下限"这条我**没单独点名**的路径。

---

## 5. 复现方法与探针说明

本轮四个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `probe_handshake.mjs`（沿用上一轮） | P1-1 | 新进程的 `rootUri` 现在是 `file:///NEW-SCOPE`（上一轮是 `OLD-SCOPE`） |
| `probe_r6.mjs` | P1-2 / 状态栏七态 | `indexOnOpen=never` ⇒ 无会话无 socket；`unknown` ⇒ 有会话；七个宿主状态下的 key / tone / 两个按钮 |
| `probe_r6_settings.mjs` | `605ad1d` | 被关掉的 typescript 在开关列表里；被关掉**且未安装**的 java 不在 |
| `probe_session_failed.mjs`（沿用上一轮） | P1-2 | 宿主无服务器时 0 回应 |

探针 A 段用**真实的 `WorkbenchStore`**（不是测试替身），所以 `lspIndexDecision` 的四条规则（全局开关 / `indexOnOpen: 'never'` / 记住的内存答复 / 本次会话的决策）都是真的在跑；状态栏那一段用 esbuild 打包 `Workbench.jsx`（与 `tests/client-status-render.test.mjs` 同一套做法，但输出落在 `%TEMP%`，不在仓库里）。

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -6
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 4b8af00 8e0ed73 --stat

# 测试（900 / 900）
npm --prefix dsh-ide-workbench test

# 探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\probe_handshake.mjs"
node "$env:TEMP\probe_r6.mjs"
node "$env:TEMP\probe_r6_settings.mjs"
```

---

## 6. 一句话总结

**上一轮 5 条全部修复、修法比我建议的更周全（还补上了我漏掉的异步竞态与连带影响），开发方自己发现的"启动时恢复的项目"这一类也处置成立——误报确实没了。**

**本轮只剩两个低危的边界缺口**：【重新连接】按钮跟着显示层的让位一起消失、而菜单提示仍指向它（R6-1）；`605ad1d` 对"被关掉且未安装"的语言无效（R6-2）。**两条都不是设计问题，是出口与覆盖面没对齐。**
