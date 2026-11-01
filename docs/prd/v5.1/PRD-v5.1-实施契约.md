# PRD-v5.1 实施契约（跨模块接口约定）

> **用途**：本轮实施由多方并行推进，本文件是**跨模块的接口约定**。凡是本文件写死的东西，各方**不得**自行改名或改语义；本文件没写的东西由各自模块自行决定。
> **基线**：`dsh-ide-workbench` commit `238668e`（分支 `main`）。**web 变体 `dsh-ide-workbench-web` 停在 `605ad1d`，本轮不做同步**（见 §5「同步策略」）。

---

## 1. 设置项（`src/host/settings-defaults.js` + `src/host/settings-store.js`）

`DEFAULT_LSP_SETTINGS` 新增 / 变更：

| 键 | 类型 | 默认值 | 语义 |
|---|---|---|---|
| `budgetRatio` | number | `0.25` | 机器级总预算占总内存的比例（MEM-08） |
| `budgetCapMB` | number | `4096` | 机器级总预算的绝对上限（MB，MEM-08） |
| `maxConcurrentIndexes` | number | `0` | `0` = 不限制（由预算决定）；`>0` = 并发索引数上限（取更严者） |
| `pressureYield` | boolean | `true` | 内存压力释放阀的总开关（MEM-12）。`false` = 显式关闭压力释放 |
| `workspaceDefaults` | object | `{}` | WS-04：工作区级语义分析默认态，`{ [scopePath]: 'build' \| 'conservative' }` |
| `idlePolicy` | string | `'after'` | **新增取值 `'always'`** = 空闲退出 **且** 压力退让 |

`IDLE_POLICIES` 扩展为 `['never', 'after', 'onMemoryPressure', 'always']`。

**语义细则（必须遵守）**：

1. **压力释放阀独立于 `idlePolicy`**（MEM-12 要求 1、4）：
   - 压力定时器**默认就装**，与 `idlePolicy` 无关。
   - `idlePolicy: 'never'` **不豁免**压力释放 —— 「永不退出」指「不因闲置退出」，不是「机器要死也不退」。
   - `idlePolicy: 'onMemoryPressure'` = 不装空闲定时器、只受压力释放（保持旧语义）。
   - `idlePolicy: 'after'` = 装空闲定时器（`idleTimeoutMs`）+ 装压力定时器（**新行为**）。
   - `idlePolicy: 'always'` = 装空闲定时器 + 装压力定时器（与 `'after'` 等价，是显式写法）。
   - `pressureYield: false` = **不装**压力定时器（唯一的显式关闭方式）。
2. `workspaceDefaults` 的键是**工作区 scope 路径**（与 `memoryWarnedRoots` / `indexedRoots` 同一层，落在 `settings.lsp` 下）。
3. `settings-store.js` 的迁移函数必须让**旧文档**（缺这些键）拿到默认值，且**不得**丢已有键。

---

## 2. 宿主资源快照（`src/host/lsp.js` → `lsp.resources` / `status().resources`）

在现有快照上**新增 4 个字段**（PRD §5「API 变更」）：

| 字段 | 类型 | 单位 | 含义 |
|---|---|---|---|
| `measuredBytes` | number | bytes | **Σ 各运行中会话的实测占用**（MEM-06 的 `used_i` 之和） |
| `worstCaseBytes` | number | bytes | **最坏档**：新服务器若吃到自己的上限，机器将剩多少。`= availableBytes − ceiling_j`，**可为负** |
| `budgetBytes` | number | bytes | 机器级总预算 `= min(totalBytes × budgetRatio, budgetCapMB × 1MB)` |
| `budgetUsedBytes` | number | bytes | **Σ 各运行中会话的上限（ceiling）**，即预算已用额 |

**`reservedBytes` 的语义变了**（MEM-05）：

```
reservedBytes = Σ max(0, ceiling_i − measured_i)      ← 它「还可能再吃」多少
availableBytes = max(0, freeBytes − reservedBytes)
```

> ⚠️ 这是**破坏性语义变更**：旧值是 `Σ ceiling_i`。所有读 `reservedBytes` 的地方（宿主、客户端、测试）都必须按新语义理解。

**判定档位（MEM-07）**：

```
need_j  = min(baseline_j, ceiling_j) × memoryHeadroom     (TS: 651 MB)
soft_j  = need_j × MEMORY_SOFT_FACTOR                      (TS: 1302 MB)
floor   = memoryHardFloorMB                                (默认 256 MB)

典型档：available − need_j
最坏档：available − ceiling_j

decision:
  available < floor          → 'low'    （机器给不起，硬地板）
  available < soft_j         → 'tight'  （问用户）
  available − ceiling_j < floor → 'tight'（额外标注 worstCase = true）
  否则                        → 'ok'
```

**`worstCase` 的处置**：**不因为最坏档而硬拒**。只**如实报出来**（`worstCaseBytes` 字段 + 诊断面板显示）。真正拦住 swap 的是 MEM-08 总预算与 MEM-12 压力阀。

**新增的快照字段**（供客户端显示，客户端只读这些字段，不自己算）：

| 字段 | 含义 |
|---|---|
| `worstCase` | boolean，最坏档是否被突破（`available − ceiling_j < floor`） |
| `ceilingMB` | number，本次判定所用的上限（MB） |
| `measuredMB` | number，Σ 实测占用（MB） |

> 这些字段是 §2 表格 4 个字段的**补充**，PRD 只点名了 4 个，但客户端要画「典型 / 最坏」两行就需要它们。**统一放在同一个快照对象里**，客户端不得二次计算。

---

## 3. 上限分档（MEM-11）

`ceilingMB` = `min(分档值, 全局 lsp.memoryLimitMB)`。

| 项目规模 | 分档上限 | 判定依据 |
|---|---|---|
| 小 | `1024` MB | 源码文件数 ≤ 400 |
| 中 | `1536` MB | 源码文件数 ≤ 1000 |
| 大 | `2048` MB | 源码文件数 > 1000，或用户显式设置 |

**分档依据**：复用 `src/host/lsp.js` 已有的 `sourceCountOf()`（有界扫描：深度 ≤ 3、最多 400 个文件）。
⚠️ `sourceCountOf` **最多数到 400**，所以「小 / 中」的分界必须改用一个**轻量但不受 400 上限约束**的计数：新增一个 `projectSizeOf(directory)`，深度 ≤ 3、计数上限 2000（用于分档），**不得**全量扫描文件树。

**手动覆盖**：`lsp.servers.typescript.memoryLimitMB`（已存在）**必须**继续生效，且**优先于**分档值 —— 用户显式设置 ⇒ 直接用用户的值。

**风险控制**：分档错误的代价是大项目 OOM（exit 134）。分档**只降不升**：实测 606 MB 的项目 ⇒ 1024 MB 上限仍有余量。

---

## 4. 客户端 ↔ 宿主 的调用契约

### 4.1 `lsp.shutdown`（WS-02）

- 语义**不变**：`{ root }` → 关闭该 root 的服务器。
- **调用方在切换 root 前必须 `await` 它**（WS-02）。
- `src/client/lsp-session.js` 新增导出：
  ```js
  export async function shutdownHostLspAwaited(root)   // 失败只记日志，不抛
  ```
  旧的 `shutdownHostLsp(root)`（fire-and-forget）**保留**，供「不关心顺序」的场景使用。

### 4.2 `lsp.start` 的 `force`（MEM-10）

- `force` **只跳过 tight 档**；硬地板**永不跳过**（已是现状，别动）。
- **新增**：机器级总预算（MEM-08）用尽时，`force` **也不放行**。
- `force` 的作用域限定为**当次启动**：客户端**不得**把「仍然启动」记成跨启动的许可（见 §4.3）。

### 4.3 客户端的记忆（MEM-10 / WS-04）

| 记忆 | 容器 | 语义 |
|---|---|---|
| 「这个项目处于基础模式」 | `settings.lsp.workspaceDefaults[scopePath] = 'conservative'` | **持久化**、跨工作区、跨进程 |
| 「这个项目要索引」 | `settings.lsp.workspaceDefaults[scopePath] = 'build'` | 同上（用户手动开启后记住） |
| 「不要再问」 | `settings.lsp.memoryWarnedRoots[scopePath] = 'conservative'` | **只记住「不要」**，**不记住「可以强启」** |

**MEM-10 硬要求**：`memoryWarnedRoots` **不得**再被写成 `'accepted'`。旧的 `'accepted'` 值（历史文档）**必须**按 `'conservative'` 处理（即退化为「不再询问 ⇒ 走基础模式」），并在注释里说明原因。

**WS-04 要求 4**：`#startLspForRestored` 里的 `#rememberIndexDecision(root, 'build')` 是**副作用写入** ⇒ 恢复路径**不得**把「策略推导出来的自动启动」记成「用户决定要索引」。决策必须区分**用户决定的**与**策略推导的**：
- 用户决定的 ⇒ 写进 `workspaceDefaults`（持久）。
- 策略推导的（`'always'` 自动起服）⇒ 只写**内存态**的 `lspIndexDecisions`，**不**写 `workspaceDefaults`。

**层级（WS-04 要求 2）**：`indexOnOpen` 是**全局策略**；**工作区级默认态优先于它** —— 一个「用户明确选择过基础模式」的工作区，在 `indexOnOpen: 'always'` 下**仍然不自动建索引**。

### 4.4 焦点上报（CONC-03）

宿主需要知道「焦点所在的 root」才能排 LRU。链路：`src/host/lsp.js` 的 `attachSink` / control 通道**已有**这条链路。
客户端通过 `call('lsp.control', ...)`（或宿主已存在的等价入口）上报当前焦点 root。
**宿主侧**：收不到焦点信息 ⇒ 按「没有焦点」处理（LRU 顺序仍成立，只是焦点 root 不被特殊对待）。

---

## 5. 同步策略（两包分叉）

`dsh-ide-workbench` = `238668e`（含 L1–L7），`dsh-ide-workbench-web` = `605ad1d`（**缺** `8e0ed73`、`1dbc238`、`238668e`）。

**本轮全部实施在 `dsh-ide-workbench` 上完成**。web 变体的同步**不在本轮范围**（PRD §7 只要求「随后同步」，本轮先做主包）。
⇒ 但**必须**在 `PRD-v5.1-实施进展.md` 里写明：web 变体尚未同步，MEM-10 / WS-04 在 web 变体上**无法验收**。

---

## 6. 测试基线

| 项 | 基线 |
|---|---|
| `npm test` | **911 / 911 通过 / 0 失败** |
| `dist/client.js` | 2,960.8 KiB（重建后 `git status` 无变化 ⇒ 产物与源码逐字节一致） |

`tests/lsp-memory-gate.test.mjs`（15 条）锁的是**旧算式**（预留额＝上限）⇒ **必须逐条按新语义重写**，**不得**为了变绿而放宽断言。
新增测试文件（建议）：
- `tests/lsp-memory-measure.test.mjs` —— MEM-05/06 差值法与退路
- `tests/lsp-budget.test.mjs` —— MEM-08 总预算
- `tests/lsp-ceiling-tier.test.mjs` —— MEM-11 分档
- `tests/lsp-pressure-yield.test.mjs` —— MEM-12 + CONC-03/04 LRU
- `tests/lsp-program-key.test.mjs` —— CONC-01
- `tests/lsp-workspace-switch.test.mjs` —— WS-01/02/03
- `tests/store-workspace-defaults.test.mjs` —— WS-04 + MEM-10

---

## 7. 文案口径（MEM-09）

**只有一个口径**：`availableBytes`（宿主闸门真正判定的数）。

| 位置 | 现状 | 改成 |
|---|---|---|
| `src/host/lsp.js` 启动路径 detail（tight/low） | `freeBytes` ❌ | `availableBytes` |
| `src/host/lsp.js` `#restart` 路径 detail（tight/low） | `freeBytes` ❌ | `availableBytes` |
| `src/host/lsp.js` 崩溃重启路径 detail | `availableBytes` ✅ | 不动 |
| `src/client/store.js` 内存紧张弹窗（`:1518`） | `freeBytes` ❌ | `availableBytes` |
| `src/client/store.js` 内存不足 toast（`:1381`） | `freeBytes` ❌ | `availableBytes` |
| `src/client/Workbench.jsx:460` 诊断面板 | `availableBytes ?? freeBytes` ✅ | 保持（但要新增「最坏档」一行） |
| `src/client/SettingsPanel.jsx:706/:716` | `availableBytes ?? freeBytes` ✅ | 保持 |

**必须加一条断言测试**：遍历所有 detail 文案的构造点，确保**没有一个**用 `freeBytes`。
