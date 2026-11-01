# PRD-v5 改造需求 —— 语义分析的状态可见性、空闲策略与索引性能

> **状态**：**待实施**（本文件是规格，不含实施记录；实施记录另建 `PRD-v5-改造需求-实施进展.md`）。
> **触发**：2026-11-01 一次实机故障排查。DSH 桌面端在 13:09–13:22 之间无痕退出（同批排查结论：**与本插件无关**，见 §0.2），排查过程中暴露出语义分析（LSP）子系统的四类用户可见缺陷。
> **配套**：`docs/prd/v5/PRD-v5.md`（V5 主规格，只读）、`docs/prd/v5/PRD-v5-补充需求.md`（上一轮补充规格）、`docs/prd/v5/PRD-v5-缺陷跟踪.md`、`docs/prd/v5/PRD-v5-代码检视报告*.md`（五轮检视）、`docs/prd/v5/代码智能-性能开销评估.md`、`docs/prd/v5/代码索引内存配置.md`。
> **实测基线**：`artifacts/perf-probe-2026-11-01/DSH-ide-workbench-性能实测报告.md`（613 行，本机实测）。下文所有数字均出自该报告或本次排查的代码走查，逐条标注来源。
> **代码基线**：`dsh-ide-workbench` commit **`d223d4f`**（分支 `main`）。
>
> ⚠️ **与前几轮检视的关系**：本轮**不是**新问题，而是**上一轮已提出、但从未落地**的问题（`docs/prd/v5/PRD-v5-补充需求.md` MEM-03/MEM-04、`docs/prd/v5/PRD-v5.md` §2.6/§2.7 的验收条款）在实机上暴露；同时**纠正一条已过期的归因**（§0.3），避免重复劳动。

---

## 0. 一页速览

### 0.1 用户报告的三个现象，与它们的真实根因

| # | 用户报告的现象 | 真实原因 | 本轮是否解决 |
|---|---|---|---|
| **U1** | 底部长期显示「语义分析：启动中……」，远超 10 分钟 | **不是**语言服务器启动慢。宿主侧的 `starting` 只覆盖"spawn 进程"这一个动作（毫秒级，见 §1.1）；长挂是**客户端冻结在陈旧快照**上 | ✅ VIS-03 / STALE-01 / STALE-02 / STALE-03 |
| **U2** | 「就绪」过一会儿自动变成「保守版」 | 是**设计内**的 10 分钟空闲自动回收（宿主迁到 `idle`），但客户端把 `idle` 渲染成了**故障文案**「保守版」 | ✅ VIS-01 / VIS-02 / VIS-03 |
| **U3** | 手动重启索引太频繁 | 空闲回收后**没有任何自动唤醒路径**；PRD §2.6 明文要求的「再次打开文件 → 自动重启」**从未实现** | ✅ IDLE-02 |

> 三个现象是**同一个根因族**的不同切面：**"语义能力的存活"与"语言服务器进程的存活"被绑死在同一个状态字面上**，于是"进程被回收"被显示成"功能坏了"。

### 0.2 附带结论：DSH 13:22 的退出与本插件无关

同批排查的结论（完整证据见 §附录 C）：

- DSH 桌面端的 **Electron 壳**在 13:09:48 – 13:22:26 之间消失；13:22:26 的新实例由 **explorer.exe** 拉起（手动重启，不是 DSH 自重启）。
- **DSH Host 子进程没有死** —— 若 Host 死亡必然留下 `crash-*-host.log`，当天没有（最新一份仍是 2026-10-31）。
- **没有任何 Windows 级崩溃记录**：无 Application Error 1000、无 WER/APPCRASH、无 Crashpad、无 CrashDumps、无 Resource-Exhaustion 事件。
- 最可能是**用户误触退出**：DSH 的退出确认框在"没有运行中任务、没有定时任务"时**静默跳过**（DSH 侧 `main.js:11666-11673`），而托盘「退出 DeepSeek Harness」与「应用 → 退出」都是一键入口。

**本插件不可能导致这次退出**，已逐条核实：

| 核实项 | 结论 |
|---|---|
| 插件源码里的终止原语 | 只有 `handle.terminate()`（语言服务器子进程）、`worker.terminate()`（插件自己的 frame worker）、`handle.signalForeground()`（终端 PTY）。**无** `process.exit` / `process.kill` / `taskkill` / 按镜像名杀进程 |
| Windows 进程隔离 | 语言服务器跑在**专属 Win32 Job Object**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）里，只有 LSP 子树在 job 内；`TerminateJobObject` 物理上够不到宿主 |
| 空闲退出 / 看门狗路径 | 只做状态迁移与计数，**无** `process.exit` |
| 故障路径 | 插件的异常若非本插件自身，会交给宿主的 fail-loud handler → `proc.exit(1)`，而这条路径**必然**留下 `crash-*-host.log` + 崩溃恢复对话框（10-31 的两次即如此） |

⇒ **本插件对宿主进程没有终止能力。** 唯一能让宿主死的是插件自身抛出的异常，那条路径**不静默**；而 10-31 那两次（`illegal language server state transition: idle → building`、未捕获 `write EPIPE`）**均已在本仓库修复**（`src/host/lsp.js:2292-2293` 的 `restarting` 守卫 + `:2256` 的 `#safely` 包裹、`:1652-1660` 的 `stdin.on('error')`）。

### 0.3 纠正一条已过期的归因

`docs/prd/v5/PRD-v5-代码检视报告-补充需求轮.md:56` 的 R1「看门狗把『通知』当『请求』」**对当前代码已不成立**：

```
src/host/lsp-worker.js:147-158
export function requestOf(text) {
  if (!text.includes('"id"')) return null      // 没有 id 的载荷不可能是请求
  ...
  const id = idOf(parsed)
  if (id === null) return null                  // JSON-RPC 通知没有 id → 不计数
```

宿主侧只有 `session.pendingRequests` 参与超时计数，而它只由 worker 的 `request` 消息填充（`src/host/lsp.js:1784-1791`）——通知**永不进入**。

⇒ **不要**按 R1 去改看门狗计数，那会改错地方。真正仍在的"越慢越被杀"自触发循环，成因是另一套组合：**构建预算 600000 ms × 崩溃阈值 3 × 重启预算 1 × 降级无提示**（见 CRASH-01）。

### 0.4 本轮条目一览

| ID | 条目 | 类型 | 优先级 | 核心锚点 | 一句话验收 |
|---|---|---|---|---|---|
| **VIS-01** | 新增 `suspended` 状态，把「主动回收」与「故障」彻底分开 | 体验 | **P0** | `src/host/lsp.js:180-191` | 空闲 10 分钟后状态栏显示**灰色**「语义分析：已休眠（省内存）」，不再是黄色「保守版」 |
| **VIS-02** | `idle` / `degraded` / `failed` / `cancelled` 四态文案分离 | 体验 | **P0** | `src/client/Workbench.jsx:410-419` | 四种状态在状态栏上是四个**可区分**的文案与色调 |
| **VIS-03** | `suspended` / `idle` 下状态栏直接给出【重新建立索引】 | 体验 | **P0** | `src/client/Workbench.jsx:447-448` | 休眠后状态栏上就有重建按钮，不必进诊断面板 |
| **VIS-04** | 降级必须有 toast（补 PRD §2.7 的硬性验收） | 体验 | **P0** | `src/client/store.js:1803-1809` | 崩溃/降级时弹**一次** toast；休眠**不弹** |
| **STALE-01** | `deactivate()` 不得清空 LSP 状态轮询 | 缺陷 | **P0** | `src/client/store.js:1682-1693` | 工作台失活后状态栏**不再冻结**在旧值 |
| **STALE-02** | 状态轮询失败必须标记「陈旧」，不得保留旧值 | 缺陷 | **P0** | `src/client/store.js:1728-1737` | 轮询失败时状态栏显示「状态未知（正在重试…）」 |
| **STALE-03** | `starting` / `restarting` 必须给出取消入口与已耗时 | 缺陷 | **P0** | `src/client/Workbench.jsx:442`、`src/host/lsp.js:1517` | 启动 60 s 后出现【取消索引】，并显示「已等待 N 分 M 秒」 |
| **IDLE-01** | 空闲策略用户可选：永不 / N 分钟后 / 仅内存紧张时 | 体验 | P1 | `src/host/settings-defaults.js` | 设置页可选「永不退出」，此后**永不**自动变保守版 |
| **IDLE-02** | **唤醒自启**：空闲释放后首次语义操作自动拉起 | 缺陷 | **P0** | `src/host/lsp.js:1047-1060` | 休眠后按 F12 即自动恢复，**无需**手动重建 |
| IDLE-03 | 空闲退出不得清空宿主侧文档表 | 缺陷 | P1 | `src/host/lsp.js:2108` | 唤醒后宿主与客户端的文档同步状态不脱节 |
| IDLE-04 | 构建 program 期间不装空闲定时器（消除 600000/600000 重合） | 缺陷 | P1 | `src/host/lsp.js:2062-2071` | 大项目构建期不会被空闲定时器误杀 |
| IDLE-05 | `#onIdle` 提前返回时必须补装定时器 | 缺陷 | P2 | `src/host/lsp.js:2079-2088` | 任何状态下空闲定时器都不会丢失 |
| **SCOPE-01** | 索引根收敛到项目根，不吃整个工作区 | 性能 | **P0** | `src/host/lsp.js:1300-1522` | program 从 6 个项目 / 2,335 文件降到 1 个项目 |
| **SCOPE-02** | 为仓库补 `tsconfig.json`（configured project） | 性能 | **P0** | 仓库根 | tsserver 不再需要构建 inferred project |
| MEM-01 | 内存估算基数按实测修正（256 → 400–600 MB） | 缺陷 | P1 | `src/host/lsp.js:62` | 估算不再系统性低估 1.4–2.4× |
| MEM-02 | 闸门必须累计核算已启动的服务器数 | 缺陷 | P1 | `src/host/lsp.js:1229-1276` | 放行第 3 个索引前会先算上已有两个 |
| MEM-03 | 可用内存必须扣除 standby cache | 缺陷 | P1 | `src/host/lsp.js:1229` | 不再把 652 MB standby 当可用 |
| MEM-04 | `cancelAfterMs` 暴露到设置页 | 体验 | P2 | `src/client/SettingsPanel.jsx:535-566` | 用户可调取消按钮出现的等待时间 |
| CRASH-01 | OOM 崩溃信号竞态：按 generation 去重，不浪费重启预算 | 缺陷 | P1 | `src/host/lsp.js:2206-2213` | SIGKILL 后服务器**真的重启一次**再降级 |
| CRASH-02 | 降级链必须可自解释 | 缺陷 | P1 | `src/host/lsp.js:2235-2238` | 降级 detail 写明「因 N 次请求超时 + 重启预算已用尽」 |
| PERF-01 | 2 秒轮询在状态未变时不得触发面板重渲染 | 性能 | P1 | `src/client/store.js:1936-1938` | 空仓库下 CommitPanel 不再每 2 s 重渲染 |
| PERF-02 | `localeCompare` 换普通比较（实测慢 7.9×） | 性能 | P2 | `src/host/search.js:84-87` | 10 万路径排序 < 25 ms |
| PERF-03 | CodeMirror 语言包按需加载 | 性能 | P2 | `src/client/CodeEditor.jsx:40-52` | bundle 减少 ≈ 573 KB（21%） |
| PERF-04 | 每次渲染拼接 120 KB CSS 字符串 | 性能 | P2 | `src/client/index.jsx:225` | 不再每帧重解析整份样式表 |

### 0.5 本轮非目标

- **不做** AI 内联补全（FIM）、**不做** LSP 重命名 / 格式化（沿用 `docs/prd/v5/PRD-v5.md` §0.2 #6 的立场）。
- **不做**代码图（codegraph）引入（沿用 `docs/prd/v5/PRD-v5.md` §0.1 的决策）。
- **不做**"保留进程、只丢 program"的 tsserver 私有参数注入：tsserver **没有**公开的该开关，本机亦未验证其私有参数。**替代路径是 IDLE-02** —— 进程照旧回收，但唤醒是自动且便宜的（文件还在 OS 页缓存，重建通常更快，见 `docs/prd/v5/代码索引内存配置.md:180`）。
- **不承诺**"大项目首次语义请求 < 10 分钟"：实测受 tsserver 的 program 构建支配，插件侧只能收敛**范围**（SCOPE-01/02），不能改变量。
- **不修** DSH 桌面端的"退出确认静默"问题 —— 属 DSH 仓库，不在本仓库范围（§0.2）。但**建议**向 DSH 侧提 issue：无任务时退出应当有可见确认。
- **不重做**已修好的东西：`#safely` 包裹、`stdin.on('error')`、`restarting` 守卫、`requestOf()` 的通知过滤 —— 这些**不要再动**。

---

## 1. VIS —— 状态语义重构

### 1.1 事实核实（先读，否则会重复造轮子）

**宿主状态机**（`src/host/lsp.js:180-191`）：

```js
const TRANSITIONS = {
  idle: ['starting', 'idle'],
  starting: ['building', 'failed', 'degraded', 'cancelling', 'crashed', 'idle'],
  building: ['ready', 'failed', 'degraded', 'cancelling', 'crashed', 'idle'],
  ready: ['crashed', 'degraded', 'cancelling', 'idle'],
  restarting: ['building', 'failed', 'degraded', 'cancelling', 'idle'],
  crashed: ['restarting', 'degraded', 'cancelling', 'idle'],
  ...
}
```

**客户端渲染**（`src/client/Workbench.jsx:410-419`）——问题就在这里：

```js
case 'degraded':
  return { ...base, key: 'degraded', text: t('lsp.status.degraded'), tone: 'warn', action: 'diagnostics' }
case 'failed':
  return { ...base, key: 'failed',   text: t('lsp.status.degraded'), tone: 'warn', action: 'diagnostics' }
default:
  // No server runs: the workbench is in its conservative mode.
  return { ...base, key: 'idle',     text: t('lsp.status.degraded'), tone: 'warn', action: 'diagnostics' }
```

`src/client/i18n.js:1141`：`'lsp.status.degraded': '语义分析：保守版'`。

⇒ **同一个字符串对应四种截然不同的宿主状态**：

| 宿主状态 | 真实含义 | 用户看到的 |
|---|---|---|
| `degraded` | 故障降级（崩溃预算耗尽、内存不足、服务器未安装……） | 「语义分析：保守版」黄点 |
| `failed` | 启动失败 | 「语义分析：保守版」黄点 |
| **`idle`** | **主动空闲回收，无故障** | 「语义分析：保守版」黄点 |
| `cancelled` | 用户取消 | 「语义分析：已取消（保守版）」黄点 |

**`idle` 只有两条产生路径**：

1. **空闲定时器**（`src/host/lsp.js:2107`）——`#exitIdle` 里 `#transition(session, 'idle', 'the language server exited after a period of inactivity')`。默认 600000 ms（`src/host/settings-defaults.js:50`）。
2. **进程正常退出 exit 0**（`src/host/lsp.js:1731-1734`）。

**`idle` 的两个直接后果**：

- `#exitIdle` 调了 `#forgetDocuments(entry)`（`:2108`）→ 宿主的已打开文档表被清空 → 下次 `#reopenDocuments`（`:1905-1920`）无文档可开。
- 空闲后**没有任何自动重启**：`#ensureSession` 只被 `index()`（`:741`）与 `start()`（`:760`）调用；客户端只在**切换项目**时调 `lsp.start`（`src/client/store.js:1128-1129`）。停留在当前项目里，下一个语义请求会被 `#holdFor`（`:1053-1056`）吞掉 → 30 秒后 `Request timed out`。

**`indexedRoots` 不清**（`src/host/lsp.js:2093-2094` 注释 + `tests/lsp-idle-exit.test.mjs:28-43` 锁定）⇒ 切走再切回会**静默重启**、不再询问（`src/client/store.js:1202` 的 `#isIndexed(project) → 'build'`）。

### 1.2 VIS-01 —— 新增 `suspended` 状态

**问题**：「主动回收」与「故障」在状态层没有区分，客户端也共用一个文案。

**改哪里**：

| 位置 | 改动 |
|---|---|
| `src/host/lsp.js:180-191` | `TRANSITIONS` 新增 `'suspended'`：`ready: [..., 'suspended']`、`building: [..., 'suspended']`、`suspended: ['starting', 'idle', 'degraded']` |
| `src/host/lsp.js:194-205` | `PROGRESS` 新增 `suspended: 'suspended'` |
| `src/host/lsp.js:2107` | `#exitIdle` 的迁移改为 `'suspended'`，detail 改为「空闲 10 分钟，语言服务器已释放以回收内存」 |
| `src/client/Workbench.jsx:365-420` | 新增 `case 'suspended'` → 新 i18n key，**`tone: 'idle'`（灰点，不是黄点）** |
| `src/client/i18n.js:1141` 附近 | 新增 `'lsp.status.suspended': '语义分析：已休眠（省内存）'`（en 同步） |

**用户看到**：就绪 → 10 分钟后变成**灰色**「语义分析：已休眠（省内存）」，不再是黄色「保守版」。

**取舍**：要动状态机；`lsp.status` 的 `state` 取值集合变大，旧客户端读 `'idle'` 仍兼容。

**风险**：**低**。纯状态/文案层，不动进程生命周期。`assertTransition`（`:278-282`）会拒绝非法迁移，所有迁移都经 `#transition`（`:1947-1955`）与 `#safely`（`:1966-1970`）。**须补测试**：`ready → suspended` 合法、`suspended → ready` **非法**、`suspended → starting` 合法。

### 1.3 VIS-02 —— 四态文案分离

**改哪里**：`src/client/Workbench.jsx:410-419` + `src/client/i18n.js`。

| 宿主状态 | 新 key | 文案 | tone |
|---|---|---|---|
| `degraded` | 沿用 `lsp.status.degraded` | 语义分析：保守版 | `warn`（黄） |
| `failed` | 新增 `lsp.status.failed` | 语义分析：启动失败 | `error`（红） |
| `idle` | 新增 `lsp.status.idle` | 语义分析：未启用（无语言服务器） | `idle`（灰） |
| `suspended` | 新增 `lsp.status.suspended` | 语义分析：已休眠（省内存） | `idle`（灰） |

**风险**：低。注意 `lsp.status.degraded` 的**现有文案不得改动**（`docs/prd/v5/PRD-v5-补充需求.md` THEME-04 已统一过话术）。

### 1.4 VIS-03 —— 休眠/空闲态直接给重建按钮

**问题**：`src/client/Workbench.jsx:447-448`

```js
const showRebuild = lsp.rebuilding !== true
    && (view.key === 'degraded' || view.key === 'failed' || view.key === 'cancelled')
```

`view.key === 'idle'` **不在列表里** ⇒ 用户必须点开诊断面板才能手动重建。这是用户抱怨"手动重启索引太频繁"的**直接原因之一**。

**改哪里**：`showRebuild` 的条件加入 `'idle'` 与 `'suspended'`。

**风险**：低。注意 `lsp.rebuilding !== true` 的互斥条件保留，避免重建中重复触发。

### 1.5 VIS-04 —— 降级必须有 toast

**问题**：`src/client/store.js:1803-1809` 的 toast 条件只有 `next.state === 'crashed'`。而 `crashed → restarting → degraded` 在**同一毫秒窗口**内完成（`src/host/lsp.js:2215` 与 `:2211`/`:2236` 相邻），2 秒轮询**几乎不可能采到中间态 `crashed`** ⇒ **连崩溃 toast 也会被跳过**。

这直接违反 `docs/prd/v5/PRD-v5.md:344`、`:349`、`:356` 的硬性验收（"必须**有**可见提示（状态栏 + 一次 toast）"）。

**改哪里**：

| 位置 | 改动 |
|---|---|
| `src/host/lsp.js:1947-1955` | `#transition` 里当 `next === 'degraded'` 时统一 `#notify(entry, { type: 'degraded', root, detail })`（现在**只有** `#onCrash:2230` 发 `{type:'crash'}`，其余 `degraded` 迁移**不发任何事件**） |
| `src/client/lsp-transport.js:134-143` | message handler 里**先**识别控制事件（判别：`msg.jsonrpc === undefined && typeof msg.type === 'string'`），再把裸 JSON-RPC 交给 `@codemirror/lsp-client`（否则 `{"type":"idle","root":…}` 会被当成 JSON-RPC 喂给库） |
| `src/client/store.js:1803-1809` | toast 条件扩展到 `['crashed', 'degraded'].includes(next.state)` |

**用户看到**：崩溃/降级时弹**一次** toast「语义分析已暂停：<detail>」；**休眠不弹**（符合 `docs/prd/v5/PRD-v5.md:324`"空闲退出不触发任何错误提示"）。

**风险**：低。判别条件要严格 —— JSON-RPC 载荷恒带 `jsonrpc: "2.0"`。

---

## 2. STALE —— 客户端状态保真（修 U1）

### 2.1 事实核实

**`starting` 在宿主侧是毫秒级的**。`src/host/lsp.js:1464` 迁移到 `starting` 后只做三件事：

| 步骤 | 位置 | 成本 |
|---|---|---|
| 语言探测 `detectLanguage(root)` | `:1311` → `:494-507` | 6 次同步 `existsSync` |
| 内存预检 `#resourcesSnapshot` | `:1477-1491` → `:1229` | 同步，读 `os.freemem()` |
| 解析二进制 `#resolveServer` | `:1493` → `:1529-1544` | **同步**：`createRequire(...).resolve('typescript-language-server/package.json')`（Node 缓存的模块解析器，无网络、无子进程）+ 每个 PATH 项一次 `existsSync` |
| spawn 进程 `#spawn` | `:1504` → `:1556-1700` | `ctx.subprocess.spawn(spec)` **同步返回**（`docs/prd/v5-实施进展.md:40` 明确写着"同步"），无健康检查、无端口等待、无 stdout 就绪等待 |

之后 `:1516` **无条件**迁移到 `building`。

⇒ **宿主侧不存在"启动中 10 分钟"这个状态。** `restarting` 同理：`#onCrash`（`:2204`）→ `crashed`（`:2215`）→ `restarting`（`:2255`）→ 退避 2000 ms（`:2256`）→ `#restart`（`:2266`）→ `#spawn` → `building`（`:2293`），也是秒级。

**但 `Workbench.jsx:366-368` 把 `starting` 与 `restarting` 渲染成同一句「语义分析：启动中…」**，于是两者都可能被误读成"启动很慢"。

**长挂的三个真实机制**：

| # | 位置 | 缺陷 |
|---|---|---|
| 1 | `src/client/store.js:1682-1693` | `deactivate()` **直接 `clearInterval(this.lspPollTimer)`** —— 工作台一失活，`lsp.status` 就**不再被拉取**，`state.lsp.state` 永不失效，状态栏**无限期**显示最后一次的值 |
| 2 | `src/client/store.js:1715-1719` | `document.visibilityState === 'hidden'` 时**跳过轮询**（浏览器还会把 interval 降频到 ≥1/min） |
| 3 | `src/client/store.js:1728-1737` | `catch { return }` + 只在变化时覆写（`:1789-1802`）⇒ 轮询失败或宿主 handler 卡住时，**保留旧值**且无任何"陈旧"标记 |

> 机制 1 与 2 恰好命中用户报告的时间窗（"后来我没在关注 DSH"）。

**另外，`starting` 阶段 UI 给了零反馈**：

- `Workbench.jsx:366-368` 的 base 是 `{ title, detail, action: null }`（`:339`）⇒ 无动作、无耗时、无 ETA。
- **【取消索引】按钮在 `starting` 阶段不出现**：`Workbench.jsx:442` `showCancel = view.key === 'building' && cancellable`；且 `src/client/store.js:1774` **只在** `next.state === 'building'` 时才去调 `lsp.index`（那个 API 才返回 `cancellable`）。
- **但宿主是支持的**：`CANCELLABLE_STATES = ['starting', 'building', 'ready', 'restarting']`（`src/host/lsp.js:218`），`cancelIndex`（`:787-808`）对 `starting` 有效 ⇒ **UI 扣留了宿主已具备的能力**。
- 且 `session.startedAt` 在 `src/host/lsp.js:1517`（迁移到 `building` **之后**）才打，所以 `Workbench.jsx:438-441` 用 `startedAt` 算出的 `cancellable` 在 `starting` 期间**恒为 0**。

### 2.2 STALE-01 —— `deactivate()` 不得清空 LSP 状态轮询

**改哪里**：`src/client/store.js:1682-1693`。把 `clearInterval(this.lspPollTimer)` 去掉，改为**只停止渲染**（轮询继续，结果照常写进 store）。轮询本身很轻（一次 HTTP POST）。

**取舍**：工作台失活后仍会每 2 s 发一次 `lsp.status`。这是 `docs/prd/v5/PRD-v5.md` §4.3 定的 2 s 轮询，不是新增负载。

**风险**：低。客户端行为，无宿主影响。

### 2.3 STALE-02 —— 轮询失败必须标记「陈旧」

**改哪里**：`src/client/store.js:1728-1737`。`catch` 分支不再静默 `return`，而是写入一个 `lsp.statusStale = true` 标记；`Workbench.jsx` 在 `statusStale` 时渲染「语义分析：状态未知（正在重试…）」。

**验收**：拔掉宿主连接 / 模拟 `lsp.status` 失败 → 状态栏**必须**变「状态未知」，不得停留在「启动中」。

**风险**：低。

### 2.4 STALE-03 —— `starting` / `restarting` 必须给出取消入口与已耗时

**改哪里**：

| 位置 | 改动 |
|---|---|
| `src/host/lsp.js:1517` | `session.startedAt` 的赋值**提前**到 `:1464` 迁移到 `starting` 之前 ⇒ 取消按钮的 `cancelAfterMs` 计时立刻开始 |
| `src/client/Workbench.jsx:442` | `showCancel` 的条件从 `view.key === 'building'` 放宽到 `['building','starting','restarting'].includes(view.key)` |
| `src/client/store.js:1774` | `lsp.index`（返回 `cancellable` 的那个 API）的拉取**移出** `building` 分支，改为对 `starting/building/restarting` 都拉 |
| `src/client/Workbench.jsx:366-368` | `starting` / `restarting` 的文案加上已耗时：「语义分析：启动中…（已等待 2 分 14 秒）」 |

**验收**：启动语言服务器 → 60 s 后状态栏出现【取消索引】；点击后 ≤ 2 s 进入「已取消（保守版）」且**无残留进程**（沿用 `docs/prd/v5.md:287` 的验收口径）。

**风险**：低。宿主侧只改了一个赋值位置。

---

## 3. IDLE —— 空闲策略与唤醒

### 3.1 事实核实

**空闲定时器的完整链路**：

| 环节 | 位置 | 事实 |
|---|---|---|
| 默认值 | `src/host/settings-defaults.js:50` / `:57` | `idleTimeoutMs: 600000`（10 分钟）、`autoExit: true` |
| 装配 | `src/host/lsp.js:2062-2071` | `#armIdleTimer`；`lsp.autoExit === false` 则不装；`setTimeout(...).unref?.()` |
| 复位 | `src/host/lsp.js:2051-2054` | `#touch`；只在两处被调：`relayToServer`（`:1058`）与 `#onWorkerMessage` 的 message 分支（`:1774`） |
| 触发 | `src/host/lsp.js:2079-2088` | `#onIdle`：先清 `session.idleTimer = null`；`elapsed < timeout` 则补装；否则 `#safely(this.#exitIdle(...))` |
| 动作 | `src/host/lsp.js:2098-2112` | `#exitIdle`：**只对 `ready` / `building` 生效**；`#writeDidClose` → `#terminateAndWait` → `#teardownSession` → 迁移 `idle` → `#forgetDocuments` → `#notify({type:'idle'})` |
| 杀进程 | `src/host/lsp.js:2305-2325` | `#terminateAndWait`：`handle.terminate()` + `waitForExit()` 与 `graceMs + 500 = 2500 ms` 竞速；**只杀语言服务器子进程**（Windows 上经 Job Object），**不涉及宿主** |

**装配点只有 4 个**：`:1519`（`#startSession` 迁 `building` 后）、`:2053`（`#touch`）、`:2084`（`#onIdle` 补时）、`:2297`（`#restart` 迁 `building` 后）。

**⚠️ 定时器丢失的洞（IDLE-05）**：`#onIdle` 在 `:2080` 先把 `session.idleTimer` 置 null；若此时状态既不是 `ready` 也不是 `building`，`#exitIdle` 在 `:2100` **提前返回且不补装** ⇒ **定时器永久丢失**。命中窗口：状态为 `starting`（`#touch` 会在 `starting` 期间装上定时器，因为 `:1577` 已创建 worker，`relayToServer` 能走到 `:1058`）而 `#spawn` 又迟迟不返回时。

**⚠️ 600000 / 600000 重合（IDLE-04）**：`idleTimeoutMs`（默认 600000）与 `BUILD_REQUEST_TIMEOUT_MS`（`src/host/settings-defaults.js:30`，也是 600000）**数值完全相同**。空闲定时器量的也是"没有 LSP 活动"，而 `#touch` 只在**有流量**时复位；大项目建 program 期间服务器可能长时间静默 ⇒ 两者同时到点。

### 3.2 IDLE-01 —— 空闲策略用户可选

**问题**：10 分钟是一个**隐形**的默认值，用户既不知道、也不能关。

**改哪里**：

| 位置 | 改动 |
|---|---|
| `src/host/settings-defaults.js:32-75` | 新增 `idlePolicy: 'never' \| 'after' \| 'onMemoryPressure'`，默认 `'after'`（保持现状）；`idleTimeoutMs` 保留为 `'after'` 模式下的时长 |
| `src/host/lsp.js:2062-2071` | `#armIdleTimer` 按策略决定是否装定时器；`'onMemoryPressure'` 改为由 `#resourcesSnapshot`（`:1229-1276`）的 `freeBytes` 低于软阈值时触发 |
| `src/client/SettingsPanel.jsx:535-559` | 把现在的「空闲退出 (分钟)」+「空闲时退出服务器」两个控件合成一个下拉：永不 / N 分钟后 / 仅内存紧张时 |
| `src/host/settings-store.js:15` | `SETTINGS_VERSION` 4 → 5，并补迁移（`migrateLspSettings`，`:212-233`） |

**用户看到**：设置页可选「永不退出」⇒ **再也不会**自动变保守版。

**取舍 / 风险**：**中低**（默认行为不变，向后兼容）。真风险：「永不退出」让 1.8–2.2 GB 常驻（实测 `docs/prd/v5/代码智能-性能开销评估.md:40-42`）⇒ 该选项**必须**明确警告"大项目可能占用数 GB"。

### 3.3 IDLE-02 —— 唤醒自启（修 U3）

**问题**：`docs/prd/v5/PRD-v5.md:319`、`:323`、`:915` 明文要求"**用户再次打开文件 → 按 §2.2 重新做内存预检 → 通过则重启语言服务器**"，**从未实现**。实测链路：空闲释放后，下一个语义请求被 `#holdFor`（`src/host/lsp.js:1053-1056`）存进 `entry.pending` 并 `return false` ⇒ **该请求永远不会被回答**；客户端 30 秒后 `Request timed out`，而状态栏因为不在 `ready` 分支里，**连「不稳定」都不显示**（`Workbench.jsx:387` 的判定只在 `case 'ready'` 内）。

**改哪里**：`src/host/lsp.js:1047-1060` `relayToServer(root, text)` —— 当 `session.worker === null` 且会话是**被空闲释放**的（而非用户 `lsp.shutdown` 停的）时，**异步**触发 `#ensureSession(entry, session.languageId)`（`:1285-1291`），载荷继续留在 `entry.pending` ⇒ `#spawn` 的 `#replayPending`（`:1694`、`:1100-1106`）会在进程起来后自动重放。内存预检走 `#startSession` 现成路径（`:1477-1491`）。

**客户端配套**：`processId` 变化时客户端复位预算的机制已在（`src/client/store.js:1752`、`src/client/lsp-session.js:1091-1094` 的 `watchServerProcess`）⇒ 重启后 `semanticAnswers` 归零，首个语义请求重新拿 10 分钟预算（`src/client/lsp-session.js:703-707`）。

**用户看到**：空闲后**第一次**按 F12 / 触发补全 / 打开文件 ⇒ 服务器自动起来（「启动中…」→「索引中…」→「就绪」），**不需要任何手动操作**。内存紧张时按 §2.2 弹窗询问（`src/client/store.js:1174-1182`）。

**取舍 / 风险**：**中**。

- ① 用户已明确选过「使用基础模式」的项目被自动拉起 ⇒ 需用 `settings.lsp.memoryWarnedRoots[root] === 'conservative'`（`src/client/store.js:1219-1226`）作抑制标记。
- ② 唤醒时正好内存紧张 ⇒ 弹窗打扰 ⇒ 用 `memoryWarnedRoots` 去重。
- ③ 启动窗口内的并发载荷受 `MAX_PENDING_PAYLOADS = 64`（`src/host/lsp.js:226`）限制；`initialize` 有独立槽位（`:1082-1084`）不受影响。
- ④ **必须同时修 IDLE-03**（文档表被清空的问题），否则唤醒后宿主与客户端的文档同步状态脱节。

### 3.4 IDLE-03 —— 空闲退出不得清空宿主侧文档表

**问题**：`#exitIdle`（`src/host/lsp.js:2108`）调 `#forgetDocuments(entry)`，把宿主的已打开文档表清空；唤醒后 `#reopenDocuments`（`:1905-1920`）无文档可重开。

**改哪里**：`src/host/lsp.js:2108` —— 空闲退出时**保留** `entry.documents`，只对客户端发 `didClose` 通知（这样编辑器的本地状态不被改动，而宿主的文档表仍可用于重开）。

**取舍**：宿主会多持有一份文档内容副本（大文件有内存成本；`src/client/store.js` 侧另有 1 MB 上限的先例）。

**风险**：低。

### 3.5 IDLE-04 —— 构建 program 期间不装空闲定时器

**改哪里**：`src/host/lsp.js:2062-2071` —— 当会话仍在构建 program（判据可复用 `isBuildingProgram(session)`，`:567-574`：`realAnswers === 0` 且有未答的语义请求）时**不装**空闲定时器；或把超时改成 `max(idleTimeoutMs, BUILD_REQUEST_TIMEOUT_MS + 60000)`。

**副作用**：构建期可能多占几分钟内存 —— 那时内存本来就被 program 占着，回收也没意义。

**风险**：低。

### 3.6 IDLE-05 —— `#onIdle` 提前返回时必须补装定时器

**改哪里**：`src/host/lsp.js:2079-2088` —— `#exitIdle` 因状态不是 `ready`/`building` 而提前返回（`:2100`）时，**补装一次**定时器。

**验收**：让会话停在 `starting` 超过 10 分钟 → 定时器仍在 → 之后仍能正常空闲退出。

**风险**：极低（定时器已 `unref`）。

---

## 4. SCOPE —— 索引范围与首次构建

### 4.1 事实核实（实测）

**本机工作区根** `D:\Code\Node\DSH-IDE-TOOLWINDOWS-ROOT`：

| 项 | 实测值 |
|---|---|
| `tsconfig.json` / `jsconfig.json` | **零个**（全仓递归搜索，排除 `node_modules` / `.git`） |
| 根目录下的 `package.json` | **无** |
| ts/js 文件总数 | **2,335** |
| 其中在 `node_modules` 内 | **1,960**（68.7 MB） |
| 其中 `.d.ts` | **921**（7.39 MB） |
| 项目源码（不含 node_modules） | **375**（15.5 MB） |
| 顶层子项目 | `dsh-ide-workbench`(159) / `dsh-ide-workbench-web`(159，**同一份源码的第二遍**) / `qa-sandbox`(36) / `artifacts`(14) / `qa-tools`(3) / `logo-test-empty`(4) |
| 真正的 TS/TSX 源文件 | **4 个** |

**为什么这会变成"推断项目"**：

1. `detectLanguage(root)`（`src/host/lsp.js:494-507`）以 `['tsconfig.json','jsconfig.json']` 为 TypeScript 标记 → 找不到 → **兜底 `return 'typescript'`**（`:506`）。
2. `typescript-language-server@6.0.2` **总是**给 tsserver 传 `--useInferredProjectPerProjectRoot`，其隐式项目默认为 `strict: true, strictNullChecks: true, strictFunctionTypes: true`。
3. 插件只注入了 `maxTsServerMemory`（`src/host/lsp-worker.js:99-115`）——**没有** `preferences`、**没有** `disableAutomaticTypeAcquisition`、**没有** `tsserver.path`。

⇒ 无 `tsconfig` ⇒ tsserver 必须建**推断项目** ⇒ 它要吞下整个 root（2,335 文件 / 84 MB）。

**实测的索引成本**（`artifacts/perf-probe-2026-11-01/`）：

| 项目规模 | 进程树峰值 RSS | 备注 |
|---|---|---|
| 60 模块 | **363 MB** | conhost 8 + wrapper 135 + node 151 + **tsserver 70** |
| 300 模块 | **434 MB** | tsserver 65 |
| 600 模块（含中心依赖） | **606 MB** | **tsserver 391 MB**（+321 MB） |
| 3 个并发索引 | **1,347 MB**（每个 449 MB） | 60→300 涨 71 MB；300→600 涨 172 MB（**不会无限增长，但增长显著**） |

### 4.2 SCOPE-01 —— 索引根收敛到项目根

**问题**：`cwd: entry.root`（`src/host/lsp.js:1609`）+ `rootUri`（`src/client/lsp-session.js:767`）= **工作区根**，把 6 个独立项目合并成一个 program。

**改哪里**：两条路径，**先做后者（零改动）**：

1. **【立即可做，无需改代码】** 把项目根换成 `…\dsh-ide-workbench`。用户的 `settings.json` 的 `indexedRoots` 里**已经有它**（`at` = 2026-11-01 06:29:21），所以 `#isIndexed(project)`（`src/client/store.js:1202`）返回 `'build'` ⇒ **不再弹索引决策框**，直接启动。program 从 6 个项目 / 2,335 文件降到 1 个项目 / 159 文件。
2. **【插件侧】** 在 `#startSession`（`src/host/lsp.js:1300-1522`）增加一条**作用域收敛规则**：当 root 下存在多个独立 `package.json` / 子项目时，以**最近的子项目根**为 program 范围（或提供一个 `lsp.indexScope` 设置项）。

**用户看到**：首次语义请求从"数分钟"降到"数秒"；索引内存从 606 MB 降到 363 MB 量级。

**取舍 / 风险**：**中**。跨项目的 `go to definition` 将不再解析（直到各子项目各有 `tsconfig`）。这必须在 §0.4 的范围表里**显式写明**，并在 UI 上让用户知情（索引决策弹窗里说明范围）。

### 4.3 SCOPE-02 —— 补 `tsconfig.json`

**问题**：无 `tsconfig` ⇒ 推断项目 ⇒ 慢 + 严格模式 + 吃整棵树。

**改哪里**：`dsh-ide-workbench/tsconfig.json`（新增）：

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "docs"]
}
```

**取舍**：插件自身是纯 `.js`（`package.json` 无 tsconfig，`scripts/build.mjs` 用 esbuild），因此 `checkJs: false` 即可，不需要把项目变成 TS 工程。

**风险**：低。**注意**：这是**仓库**层面的改动，不是插件代码改动；`tsc` 不参与构建（esbuild），所以不会影响 `npm run build`。

---

## 5. MEM —— 内存闸门

### 5.1 事实核实（实测）

**闸门实现**（`src/host/lsp.js:1229-1276`）：

```
needMB   = min(baselineMB, 生效上限) × 余量系数 1.5
软阈值    = needMB × 2
硬下限    = 256 MB
判定      = free < 硬下限 → 'low'（拒绝）
           硬下限 ≤ free < 软阈值 → 'tight'（问用户）
           否则 'ok'（直接启动）
```

**三个可证伪的问题**（实测报告 §2.2）：

| # | 问题 | 实测 |
|---|---|---|
| ① | **闸门只读启动瞬间的整机可用内存，从不做累计核算** | 16 GB / 4 GB 空闲的机器上放了 **2 个**才在第 3 个拒绝；8 GB / 2 GB 空闲的机器上第 3 个因可用内存算成 **−1,518 MB** 被拒。**闸门从不知道自己已经放了多少个服务器** |
| ② | **`os.freemem()` 把 standby cache 当成可用内存** | `os.freemem()` = 3,852 MB；Windows `FreePhysicalMemory` = 3,987 MB；**standby cache 652 MB**；真实未提交 ≈ 3,200 MB ⇒ **高估约 652 MB**，恰好是**一个中型索引的全部成本** |
| ③ | **`force` 可以跳过整个检查** | `src/index.js:708` 的 `lsp.start` 接受 `force: true`（`src/host/lsp.js:1477` 据此跳过预检）⇒ 一次误点就能突破所有保护 |

**另外**：估算基数 `memoryBaselineMB: 256`（`src/host/lsp.js:62`）来自 `docs/prd/v5/代码智能-性能开销评估.md` §1.1，而那份文档测的是**空载包装进程**、**不是索引成本**（实测报告 §5.1）⇒ **低估 1.4–2.4×**。

**宿主侧没有上限**：`src/host/lsp.js:260` 的 `ROOTS` 是**模块级 Map**，`#entry()`（`:1124`）只 `set` 从不 `delete`（全仓无 `ROOTS.delete`）⇒ 每访问过一个项目 root 就永久驻留一份 entry（含 `documents` / `sinks` / `pending`）⇒ **无界累积**（实测报告 §5.2 / N6）。

### 5.2 MEM-01 —— 内存估算基数按实测修正

**改哪里**：`src/host/lsp.js:62` 附近 `LSP_REGISTRY` 的 `memoryBaselineMB` —— TypeScript 从 256 提到 **400–600 MB**（按实测中位数取 434，或按 `docs/prd/v5/代码索引内存配置.md` 的口径给出可配置区间）。

**取舍**：估算变保守 ⇒ 闸门更容易判 `tight` ⇒ 更多弹窗。**必须同时做 MEM-02/MEM-03**，否则闸门会因为"更准的估算 + 更脏的可用内存"而变得过度拒绝。

**风险**：中。

### 5.3 MEM-02 —— 闸门必须累计核算

**改哪里**：`src/host/lsp.js:1229-1276` `#resourcesSnapshot` —— 除了"整机可用内存"，还要减去**本进程已启动的语言服务器的实际 RSS 之和**（可从 `session.handle` 的进程信息取，或维护一个已启动服务器的预留额账本）。

**验收**：16 GB / 4 GB 空闲的机器上，放行第 3 个索引前会先算上已有两个 ⇒ 不会放行到把机器推到 swap。

**风险**：中。需要一个"已预留额"账本，且必须在服务器退出时可靠地减掉（`#terminateAndWait`、`#teardownSession`、`#onCrash` 三条路径都要覆盖）。

### 5.4 MEM-03 —— 可用内存必须扣除 standby cache

**改哪里**：`src/host/lsp.js:1229` —— 读 Windows 的 `FreePhysicalMemory`（已含 standby 的语义差异）而非 `os.freemem()`，或显式扣除 standby cache。

**风险**：低。

### 5.5 MEM-04 —— `cancelAfterMs` 暴露到设置页

**问题**：设置页有 `enabled` / `indexOnOpen` / `memoryLimitMB` / `freeMemoryThresholdMB` / `memoryHeadroom` / `memoryHardFloorMB` / `idleTimeoutMs` / `requestTimeoutMs` / `autoExit` / `autoRestart`，**唯独没有** `cancelAfterMs` ⇒ 60 s 这个阈值用户调不了。

**改哪里**：`src/client/SettingsPanel.jsx:535-566` 增加一项；`src/host/settings-defaults.js` 已有默认值，无需改。

**风险**：低。

---

## 6. CRASH —— 崩溃与恢复

### 6.1 事实核实

**降级链**（`src/host/lsp.js:2204-2259`）：

| 场景 | 结果 | 位置 |
|---|---|---|
| 首次崩溃（exit 134 = OOM） | `crashed` → **自动重启 1 次**（退避 2000 ms） | `:2215`、`:2254-2258` |
| 再次崩溃 | **`degraded`**（重启预算 `session.restarts >= 1` 已用尽） | `:2235-2238` |
| 崩溃时内存不足 | **`degraded`**，不重启 | `:2246`、`:2250` |
| `autoRestart === false` | 第一次崩溃即 **`degraded`** | `:2231-2233` |
| **崩溃信号竞态** | **`degraded`，且重启预算未用完** | `:2210-2213` |

**竞态的机理**（实测报告 §2.3 / §5.3，探针 `p5b-degradation-chain.mjs:74-86`）：

```
stdout 'end' 回调（:1709）先到 → #onCrash → crashed → restarting
handle.done 兑现（:1738）再调 #onCrash → 命中 :2210 的 state === 'restarting' → 直接 degraded
```

⇒ **被 OOM 杀掉**（而非主动退出）时，重启机会被白白浪费。

**没有提示**：唯一的 toast 只覆盖 `crashed`（`src/client/store.js:1804`），而 `crashed → restarting → degraded` 在同一毫秒窗口完成 ⇒ **2 秒轮询采不到 `crashed`** ⇒ 连崩溃 toast 都被跳过。**这违反 `docs/prd/v5/PRD-v5.md:344`/`:349`/`:356` 的硬性验收。**（VIS-04 修的就是这一条。）

### 6.2 CRASH-01 —— 崩溃信号按 generation 去重

**改哪里**：`src/host/lsp.js:2206-2213` —— 记录 `session.crashedGeneration`；同一 generation 的第二个崩溃信号**忽略**而不是降级；`state === 'restarting'` 的降级改成"等 `#restart` **真正失败**再降级"。

**验收**（仿 `p5b-degradation-chain.mjs:74-86`）：同时触发 `stdout.end()` + `exit(134)` ⇒ 断言 `spawned.length === 2`（真的重启了一次）且最终状态**不是** `degraded`。

**风险**：**中**。去重写错 ⇒ 以为忽略了信号其实服务器已死 ⇒ 不重启。**必须补一条并发测试兜底。**

### 6.3 CRASH-02 —— 降级链必须可自解释

**问题**：降级 detail 有三种来源（`:2211` / `:2232` / `:2236`），但**都不写明"因为什么"**。`:2236` 的文案是 "The automatic restart was already used once, so the server was not started again." —— 没说是被什么杀的。

**改哪里**：`src/host/lsp.js:2192-2196` `#noteTimeout` 把 `reason` 带进 `#onCrash`；`:2211` / `:2232` / `:2236` 的 detail 统一成「<原始原因>；自动重启预算已用尽（1 次），语义分析已暂停」。

**验收**：状态栏 tooltip 与诊断面板能直接回答"为什么降级"。

**风险**：低。

---

## 7. PERF —— 客户端热路径

### 7.1 事实核实（实测报告 §4）

> **总判断：瓶颈不在 LSP（它被隔离得很好），而在客户端的 2 秒轮询链路。**

| 项 | 位置 | 实测 |
|---|---|---|
| 定时器 | `src/client/store.js:1659`、`:1675` | `setInterval(pollStatus, 2000)`；`lsp.status` 另有独立 2 s 定时器 ⇒ **90 次 HTTP POST/分钟** |
| 宿主先跑 `git rev-parse` | `src/index.js:315` | `repoEnv()` **无缓存**，每次都 spawn |
| 再跑 `git status` | `src/host/git.js:332` | `--porcelain=v2 --branch -z --untracked-files=all` |
| 再跑 2 × `git diff --numstat` | `src/host/git.js:340,342` | Commit 窗可见时 |
| 写回 store | `src/client/store.js:1938` | `this.set({status, ...})` —— **每次 poll 都是新对象** |
| 切片引用失效 | `src/client/ProjectPanel.jsx:424`、`src/client/CommitPanel.jsx:52` | `status: state.status`（整个对象）、`entries: state.status.entries`（新数组） |

⇒ **放大器**：即使仓库**一个字节都没改**，这两个面板仍然每 2 秒重渲染一次。`src/client/store.js:1936` 算出了 `changed` 变量，但**它只用于别的判断，没有用来短路这次 `set`**。

实测：`shallowEqual(projectSlice) : false` ⇒ `ProjectPanel re-renders every 2 s: true`。

⇒ **代价：60–120 个 git 子进程/分钟**，每次 `--untracked-files=all` 还要重扫整个未跟踪树。

**其余已确认项**：

| 项 | 位置 | 实测 |
|---|---|---|
| CommitPanel changelist 过滤 | `src/client/CommitPanel.jsx:262` | 2,000 条 / 5 列表 = **26.76 ms**；20,000 / 5 = **63.16 ms**（每 2 s 一次） |
| `listFiles()` 排序 | `src/host/search.js:84-87` | `listFiles()` = **142.2 ms** / 227 文件；`localeCompare` 比普通比较**慢 7.9×**（50,000 路径：157 ms vs < 20 ms） |
| 巨型 CSS 拼接 | `src/client/index.jsx:225` | `React.createElement('style', ..., \`${xtermCss}\n${CSS}\`)` —— **每次渲染拼接 ~120 KB CSS 字符串**，触发整份样式表重解析 |
| 语言包静态引入 | `src/client/CodeEditor.jsx:40-52` | 13 个 `@codemirror/lang-*` 静态 import，**零按需加载**；永久不可达 ≈ **573 KB（bundle 的 21%）** |
| 宿主载荷缓冲 | `src/host/lsp.js` | worker 线程固定 **9 MB/线程**；1 MB 的 `didChange` 经 worker 转发一次留下约 1 MB 常驻 |

### 7.2 PERF-01 —— 轮询在状态未变时不得触发重渲染

**改哪里**：`src/client/store.js:1936-1938` —— 用已经算出来的 `changed` **短路**这次 `set`（对象引用不变 ⇒ 面板不重渲染）。

**验收**：空仓库下 `ProjectPanel re-renders every 2 s: false`、`CommitPanel re-renders every 2 s: false`。

**风险**：低。**注意**：`src/client/store.js:1936` 附近已有一个 `perf(tree): keep the status aggregate's identity while the status is unchanged` 的提交（`dd6dc17`），本条是同一思路的延伸，但**针对的是 `changed` 变量未被用于短路**这一点。

### 7.3 PERF-02 —— `localeCompare` 换普通比较

**改哪里**：`src/host/search.js:84-87`。排序的语义是"稳定、可预期"，不依赖 ICU collation ⇒ 换 `<` / `>`。

**验收**：50,000 路径排序 < 25 ms（实测基线 157 ms）。

**风险**：低。**注意**：排序结果会变（与 `localeCompare` 的序不同），若有测试依赖具体顺序需一并调整。

### 7.4 PERF-03 —— CodeMirror 语言包按需加载

**改哪里**：`src/client/CodeEditor.jsx:40-52` —— 13 个 `@codemirror/lang-*` 改为 `import()` 动态加载（按当前文件语言加载）。

**风险**：中。动态 import 会引入异步边界，需处理"语言包还没到"的瞬间（CodeMirror 允许先无高亮）。

### 7.5 PERF-04 —— CSS 不再每次渲染拼接

**改哪里**：`src/client/index.jsx:225` —— 把 `${xtermCss}\n${CSS}` 提到**模块级常量**（与 `src/client/styles.js:9` 的既有做法一致：它已经是模块级常量）。

**风险**：低。

---

## 8. 实施顺序与里程碑

| 里程碑 | 条目 | 依赖 | 产出 | 预估 |
|---|---|---|---|---|
| **M0** | SCOPE-02 | 无 | 仓库根 `tsconfig.json` | 0.2 人天 |
| **M1** | VIS-01 / VIS-02 / VIS-03 | 无 | 状态语义解耦（宿主 + 客户端 + i18n） | 0.5 人天 |
| **M2** | STALE-01 / STALE-02 / STALE-03 | 无 | 客户端不再冻结在陈旧状态 | 0.5 人天 |
| **M3** | VIS-04 / CRASH-02 | M1 | 降级可见且可自解释 | 0.5 人天 |
| **M4** | IDLE-02 / IDLE-03 | M1 | 唤醒自启 —— **U3 的正解** | 1 人天 |
| **M5** | IDLE-01 / IDLE-04 / IDLE-05 / MEM-04 | M4 | 空闲策略可控 | 0.8 人天 |
| **M6** | MEM-01 / MEM-02 / MEM-03 | M5 | 内存闸门按实测修正 | 1 人天 |
| **M7** | CRASH-01 | M3 | OOM 竞态修复 | 0.5 人天 |
| **M8** | SCOPE-01 | M0 | 索引范围收敛 | 1 人天 |
| **M9** | PERF-01 | 无 | 2 s 轮询短路 | 0.3 人天 |
| **M10** | PERF-02 / PERF-03 / PERF-04 | M9 | 客户端热路径 | 1 人天 |

**建议顺序**（按"用户可见收益 / 风险"排序）：**M1 → M2 → M3 → M4 → M0+M8**。M1/M2/M3 合计约 1.5 人天，直接消除用户今天遇到的三种误导（U1/U2 的显示问题），且全部是低风险改动。

**每个里程碑结束时**：跑 `npm test` + `npm run build`，并在 `docs/prd/v5/PRD-v5-改造需求-实施进展.md` 追加记录。

---

## 9. 测试要求

### 9.1 新增测试文件

| 文件 | 覆盖 |
|---|---|
| `tests/lsp-suspended-state.test.mjs` | VIS-01/02/03：`ready → suspended` 合法；`suspended → ready` 非法；`suspended` 的文案与 tone；`idle` / `suspended` 下 `showRebuild` 为真 |
| `tests/lsp-wake-on-demand.test.mjs` | IDLE-02/03：空闲退出后首次 `relayToServer` 自动拉起；载荷被重放；文档表被保留 |
| `tests/lsp-status-freshness.test.mjs` | STALE-01/02/03：`deactivate()` 后轮询仍在；轮询失败标记 stale；`starting` 出现取消按钮 |
| `tests/lsp-crash-generation.test.mjs` | CRASH-01：`stdout.end()` + `exit(134)` 同时发生 ⇒ `spawned.length === 2` 且状态不是 `degraded` |
| `tests/lsp-idle-policy.test.mjs` | IDLE-01/04/05：`idlePolicy: 'never'` 不装定时器；构建期不装定时器；`#onIdle` 提前返回后定时器被补装 |
| `tests/lsp-memory-gate.test.mjs` | MEM-01/02/03：累计核算；standby 扣除 |
| `tests/client-status-render.test.mjs` | VIS-02/03/04：四种状态的文案与色调；`degraded` 的 toast |

### 9.2 现有测试的回归要求

| 既有测试 | 要求 |
|---|---|
| `tests/lsp-idle-exit.test.mjs` | **需要更新**：`:28-43` 断言"空闲退出不清 `indexedRoots`"——**这条保持**（PRD §2.1 的徽标语义）；但若有断言"迁到 `idle`"的，改为 `suspended` |
| `tests/lsp-budget-agreement.test.mjs` | IDLE-04 改动后，宿主与客户端的预算必须仍一致（该测试的立意正是"两端同预算"，见 commit `920dda7`） |
| `tests/lsp-client-budget.test.mjs` | 同上 |
| `tests/lsp-error-toast.test.mjs` | VIS-04 会改变 toast 的触发条件，需同步 |
| `tests/lsp-health-status.test.mjs` | VIS-02 会改变 `unstable` 的判定位置（现在只在 `ready` 分支内） |

### 9.3 交付前检查

```sh
cd dsh-ide-workbench
npm test          # 当前基线：436 项 / 344 通过 / 92 失败
npm run build
```

> ⚠️ **基线说明**：`d223d4f` 上实测 **436 项 / 344 通过 / 92 失败**，**92 项失败全部源于 `node_modules` 为空**（缺 `ws` / `yaml` / `esbuild` / `typescript` / `react` 等），与代码无关。**开工前须先装依赖重跑一次**，得到真实的绿基线；否则无法判断新改动是否引入回归。
> （本轮文档归集后复跑，数字与 `d223d4f` 完全一致 —— **344 通过 / 92 失败**，即文档归集未引入任何回归。）

### 9.4 实机验收清单（自动化覆盖不到的部分）

- [ ] 空闲 10 分钟后，状态栏显示**灰色**「语义分析：已休眠（省内存）」，**不是**黄色「保守版」
- [ ] 休眠后状态栏上**直接**有【重新建立索引】按钮
- [ ] 休眠后按 F12，服务器**自动**起来，用户**没有**点任何按钮
- [ ] 启动语言服务器时状态栏显示「已等待 N 分 M 秒」，60 s 后出现【取消索引】
- [ ] 把宿主连接掐断，状态栏显示「状态未知（正在重试…）」，**不是**停留在旧状态
- [ ] 触发一次降级，弹出**一次** toast，文案说明原因
- [ ] 在 `…\dsh-ide-workbench` 下打开工作台，**不弹**索引决策框，直接进入「就绪」

---

## 10. 风险与回归清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| **`assertTransition` 抛错会连累宿主** | 宿主进程死亡 | 所有迁移都经 `#transition`（`src/host/lsp.js:1947-1955`）与 `#safely`（`:1966-1970`）；新增 `suspended` 后**必须**补状态机合法性测试 |
| **唤醒自启把用户明确禁用语义能力的项目又拉起来** | 打扰 + 违背用户意图 | 用 `settings.lsp.memoryWarnedRoots[root] === 'conservative'` 作抑制标记（`src/client/store.js:1219-1226`） |
| **唤醒时正好内存紧张** | 弹窗打扰 | 沿用 `memoryWarnedRoots` 去重；MEM-01/02/03 让闸门更准，减少误判 |
| **崩溃信号去重写错** | 服务器死了却不重启 | 必须补 `tests/lsp-crash-generation.test.mjs`（并发场景） |
| **索引范围收敛后跨项目跳转失效** | 功能回退 | 显式写进范围表；UI 上让用户知情；SCOPE-02 铺开后逐步恢复 |
| **内存估算调高后过度拒绝** | 语义能力起不来 | MEM-01/02/03 必须**一起**做，不能单独做 MEM-01 |
| **动态 import 语言包引入异步边界** | 编辑器短暂无高亮 | CodeMirror 允许无高亮态；按需加载只对**当前语言**生效 |
| **`localeCompare` 换普通比较后顺序变化** | 依赖具体顺序的测试/UI 变化 | 排序语义本就不承诺；逐项核对相关测试 |
| **改动 `lsp.status` 的 state 取值集合** | 旧客户端 / 旧文档失配 | `idle` 保留为合法取值；新增 `suspended` 是**增量**而非替换 |

---

## 11. 交付物

| # | 交付物 | 位置 |
|---|---|---|
| 1 | 本规格 | `docs/prd/v5/PRD-v5-改造需求.md` |
| 2 | 实施进展记录 | `docs/prd/v5/PRD-v5-改造需求-实施进展.md`（**待建**） |
| 3 | 宿主状态机与客户端渲染的改动 | `src/host/lsp.js`、`src/client/Workbench.jsx`、`src/client/i18n.js`、`src/client/store.js` |
| 4 | 设置项与迁移 | `src/host/settings-defaults.js`、`src/host/settings-store.js`、`src/client/SettingsPanel.jsx` |
| 5 | 传输层控制事件 | `src/client/lsp-transport.js` |
| 6 | 新增测试 | §9.1 的 7 个文件 |
| 7 | 仓库 `tsconfig.json` | `dsh-ide-workbench/tsconfig.json`（新增） |
| 8 | 回归基线记录 | 实施进展文件里记录"依赖装好后重跑的绿基线数字" |

---

## 附录 A —— 关键锚点速查

| 主题 | 位置 |
|---|---|
| 宿主状态机 | `src/host/lsp.js:180-191`（`TRANSITIONS`）、`:194-205`（`PROGRESS`） |
| `assertTransition` | `src/host/lsp.js:278-282` |
| `#transition` / `#safely` | `src/host/lsp.js:1947-1955` / `:1966-1970` |
| `starting` 的全过程 | `src/host/lsp.js:1464`（迁移）→ `:1477-1491`（内存预检）→ `:1493`（解析）→ `:1504`（spawn）→ `:1516`（`building`）→ `:1517`（`startedAt`）→ `:1519`（装空闲定时器）→ `:1520`（装看门狗） |
| `#spawn` | `src/host/lsp.js:1556-1700`；`ctx.subprocess.spawn` **同步**（`:1615-1617`） |
| `stdin.on('error')`（EPIPE 防护） | `src/host/lsp.js:1652-1660` |
| 就绪启发式 | `src/host/lsp.js:2008-2025`（`#scheduleReady`，延迟 1500 ms） |
| 空闲定时器 | `src/host/lsp.js:2062-2071`（装配）、`:2079-2088`（触发）、`:2098-2112`（动作） |
| `#terminateAndWait` | `src/host/lsp.js:2305-2325`（上限 `graceMs + 500 = 2500 ms`） |
| 看门狗 | `src/host/lsp.js:2119-2128`（装配，间隔 1000 ms）、`:2156-2179`（计数）、`:2192-2196`（阈值 3） |
| 崩溃与降级 | `src/host/lsp.js:2204-2259`（`:2210-2213` 竞态、`:2235-2238` 预算耗尽） |
| 通知不计入请求 | `src/host/lsp-worker.js:147-158`、`:429-437`、`:132-137`（注释） |
| 内存闸门 | `src/host/lsp.js:1229-1276`；估算基数 `:62`；余量系数 `:139` |
| `ROOTS` 不清理 | `src/host/lsp.js:260`（实测报告 N6） |
| 状态栏渲染 | `src/client/Workbench.jsx:332-421`（`lspStatusView`）、`:434-493`（`LspStatus`） |
| 重建按钮可见条件 | `src/client/Workbench.jsx:447-448` |
| 唯一的 toast | `src/client/store.js:1803-1809` |
| 2 s 轮询 | `src/client/store.js:1659`、`:1675`、`:1715-1719`、`:1728-1737`、`:1682-1693` |
| `lsp.start` 的两个调用点 | `src/client/store.js:1128-1129`（切项目）、`:1397`（手动重建） |
| `#isIndexed` | `src/client/store.js:1202`、`:1292-1297` |
| 客户端请求预算 | `src/client/lsp-session.js:703-707`（`requestBudgetOf`） |
| 握手重试上限 | `src/client/lsp-session.js:812`（`MAX_HANDSHAKE_RETRIES = 3`）、`:844-857` |
| 默认值 | `src/host/settings-defaults.js:30`（`BUILD_REQUEST_TIMEOUT_MS`）、`:50`（`idleTimeoutMs`）、`:53`、`:55`、`:57`、`:59` |
| 设置页 | `src/client/SettingsPanel.jsx:535-566` |
| 插件错误边界 | `src/index.js:164-250`（`takeover`）、`:101-104`（`isLspFault`）、`:840`（终端信号白名单） |

## 附录 B —— 术语对照

| 术语 | 含义 |
|---|---|
| **语义分析** | 用户可见的能力名 = LSP 提供的补全 / 跳转定义 / 查找引用。**不等于**某个磁盘上的"索引文件" |
| **program** | tsserver 内存里的项目模型。**"构建索引" ≡ 启动语言服务器并等它完成首次 program 构建**（`docs/prd/v5/PRD-v5.md` §0.2 #1） |
| **推断项目 / inferred project** | tsserver 在**没有** `tsconfig` 时自动构造的项目，默认 `strict: true` |
| **保守版** | 没有语言服务器时的降级形态：本地补全 + 文本查找引用 |
| **休眠 / suspended** | **本轮新增**的状态：语言服务器因空闲被回收，**不是故障**，下次操作自动唤醒 |
| **降级 / degraded** | 故障形态：崩溃预算耗尽、内存不足、服务器未安装…… |

## 附录 C —— DSH 13:22 退出的排查结论（不在本插件范围）

| 项 | 结论 |
|---|---|
| 现象 | 实例 A（11:48:52 启动）消失；实例 B 于 13:22:26 由 **explorer.exe** 拉起（手动重启） |
| 排除 Host 崩溃 | 无 `crash-*-host.log`（最新一份 2026-10-31 23:12:19）⇒ DSH 的崩溃报告器**根本没触发** |
| 排除原生崩溃 | 无 Application Error 1000、无 WER/APPCRASH、无 Crashpad、无 CrashDumps |
| 排除 OOM | 无 Resource-Exhaustion 事件（只有启动/停止） |
| 排除自动更新 | 注册表与 exe 版本仍是 `0.2.1-rc.5`；exe / `app.asar` 的 CreationTime = 2026-10-31 13:18（rc.5 那天装的）；`.updaterId` 未变；`autoInstallOnAppQuit = false` |
| 排除单实例锁冲突 | 输给锁的进程会自己退出，**在位进程 PID 不变**；13:22 是全新 PID ⇒ 旧的确实已经不在了 |
| 最可能 | **用户误触退出**。DSH 的退出确认框在"没有运行中任务、没有定时任务"时**静默跳过**（DSH 侧 `main.js:11666-11673`）；托盘「退出 DeepSeek Harness」与「应用 → 退出」都是一键入口；关**主窗口**则只是隐藏到托盘（`main.js:12894-12906`） |
| 与本插件的关系 | **无**。插件没有终止宿主的能力（§0.2）；空闲退出 / 看门狗路径都不 `process.exit`；Windows 上语言服务器在专属 Job Object 内，`TerminateJobObject` 够不到宿主 |
| 数据影响 | 无损失。3 个会话被启动时的 `session/end-seed` 收尾（DSH 的标准动作）；两个在跑的会话都是 `turn/end … completed` 正常结束 |
| 给 DSH 侧的建议 | **无任务时退出应当有可见确认**，或至少在托盘「退出」上明确提示"当前没有运行中的任务" |
