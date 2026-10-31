# PRD-v5 补充需求 实施进展 — 智能代码体验收尾、Git 着色与交互形态

> 状态：**已完成（代码与自动化）**。规格见 `docs/PRD-v5-补充需求.md`（只读，本文件不覆盖规格）。
> 代码基线：`dsh-ide-workbench` commit `13c4533e729042a2e8a92526028e20ec2852edf3`（分支 `main`）。
> 本文件记录**落地结果**、**与规格的偏差**与**验收数据**；结论与规格冲突时以规格为准。

---

## 0. 交付总览

| 项 | 结果 |
|---|---|
| 自动化测试 | **669 项 / 669 通过 / 0 失败**（基线 549 + 本轮新增 120） |
| 客户端构建 | `npm run build` 成功，`dist/client.js` **2,862,096 字节（2,793.2 KiB）** |
| 客户端体积增量 | **+87.7 KB**（预算 ≤ 150 KB ✅） |
| 新增源码 | 3 个文件（`src/client/SearchPopup.jsx`、`src/host/settings-defaults.js`、……） |
| 新增测试 | 9 个文件、119 个用例 |
| i18n | 新增 key 在 `en` 与 `zh-CN` 两张表里都有值（各 567 个） |

| 条目 | 状态 | 落在哪里 |
|---|---|---|
| THEME-01 悬停卡 / 签名帮助去掉硬编码黑白 | ✅ | `src/client/styles.js` |
| THEME-02 补全弹窗 / 引用面板跟随宿主 | ✅ | `src/client/styles.js` |
| THEME-03 代码块与语法高亮取色策略 | ✅ | `src/client/styles.js`、`src/client/CodeEditor.jsx` |
| THEME-04 索引决策弹窗精修 | ✅ | `src/client/Workbench.jsx`、`src/client/i18n.js` |
| MEM-01 内存门槛按语言估算 | ✅ | `src/host/lsp.js` |
| MEM-02 内存不足先提醒、让用户决定 | ✅ | `src/host/lsp.js`、`src/client/store.js`、`src/client/Workbench.jsx` |
| MEM-03 降级状态可见 | ✅ | `src/client/lsp-session.js`、`src/client/store.js`、`src/client/Workbench.jsx` |
| MEM-04 降级后能重新建立索引 | ✅ | `src/client/store.js`、`src/client/Workbench.jsx` |
| USAGE-01 修复语义版「查找用法」 | ✅ | `src/client/lsp-workspace.js`、`src/client/lsp-session.js` |
| SET-01 索引总开关语义收敛 + 关闭即退进程 | ✅ | `src/client/lsp-session.js`、`src/client/SettingsPanel.jsx`、`src/client/i18n.js` |
| SET-02 按语言启停 | ✅ | `src/client/SettingsPanel.jsx` |
| SET-03 内存阈值参数改造 | ✅ | `src/host/settings-store.js`、`src/client/SettingsPanel.jsx` |
| GIT-01 未跟踪文件以文件为粒度着色 | ✅ | `src/host/git.js`、`src/client/git-colors.js` |
| GIT-02 Commit 面板的目录条目 | ✅ | `src/client/CommitPanel.jsx` |
| FIND-01 全项目查找改为弹窗 | ✅ | `src/client/SearchPopup.jsx`、`src/client/store.js`、`src/client/EditorArea.jsx`、`src/client/index.jsx` |
| FIND-02 查找结果的预览与上下文 | ✅ | `src/host/search.js`、`src/client/SearchPopup.jsx` |
| PUSH-01 Commit 面板独立「推送」按钮 | ✅ | `src/client/CommitPanel.jsx`、`src/client/store.js` |
| PUSH-02 `↑N` 徽标可点并带状态说明 | ✅ | `src/client/Workbench.jsx` |
| LAYER-01 未保存修改警告高于项目选择 | ✅ | `src/client/ui.jsx`、`src/client/styles.js`、`src/client/store.js` |

---

## 1. 与规格的偏差

### 1.1 `tight` 的判定窗口比规格的速记式写法宽（MEM-01/02）

规格 §2.2 的速记式写法是 `tight = canIndex && freeBytes < needMB * 2.0`，
而 §2.3 的三段式表格写的是「`hardFloorMB <= freeBytes < needBytes * SOFT_FACTOR`」。
两者只在 `[hardFloorMB, needMB)` 这一段不同（TypeScript 约 256–383 MB）。

**按 §2.3 实现**，因为 §2.2 的验收口径要求「可用内存 300 MB 时打开 TypeScript
项目 → 能启动，给出软提醒而非直接拒绝」——那正是落在 `[hardFloor, need)` 窗口里。
若按速记式写法，300 MB 会被直接拒绝，验收项无法通过。

> 落地位置：`src/host/lsp.js` 的 `#resourcesSnapshot()`。
> 客户端的判定顺序随之固定为：**先看 `tight`，再看 `canIndex`**。

### 1.2 推送按钮的禁用条件（FIND/PUSH-01）

规格给的写法是 `disabled: !canCommit || (ahead ?? 0) === 0`。但 `canCommit`
在提交成功后立刻变成 `false`（没有待提交内容了），那样按钮恰好在用户最需要
它的时候不可点，与验收口径「提交一次改动后（不推送）→ 推送按钮**可点**」矛盾。

**实现为 `disabled = commit.pushing || ahead === 0`**，并在 `title` 里写明原因。

### 1.3 设置项的 `freeMemoryThresholdMB` 语义（SET-03）

它不再是硬门槛，而是「**无法估算内存需求时**才使用的保守兜底下限」。
有估算值时启动门槛来自估算值，因此把它改成 4096 MB 也不会阻止启动
（`tests/lsp-memory-policy.test.mjs` 有用例守着）。默认值从 2048 降到 512。

### 1.4 语义健康度的计数点（MEM-03）

规格建议在 `LSPPlugin.reportError` 的劫持里累加。实现改为**包住
`client.request(method, params)`**：只有八个语义方法
（`references` / `definition` / `declaration` / `typeDefinition` /
`implementation` / `hover` / `completion` / `signatureHelp`）被计数，
文档同步类错误不会污染计数器，`reportError` 的 toast 行为保持原样。

计数器由 `lsp-session.js` **自己写回** `store.state.lsp`（不反向 import），
在切项目、停会话与服务器重启时归零。

### 1.5 引用面板的额外一行修复（USAGE-01）

库的 `WorkspaceMapping` 只认识**请求发出时已打开**的文件，渲染面板时会抛
`Cannot map from a file that's not in the workspace`，跨文件命中会被再次丢弃。
因此 `lsp-session.js` 额外重定向了 `WorkspaceMapping.prototype.mapPosition`
（与 `redirectErrorsToToast` 同一手法）：只为面板读取过的文件按其自身文档
换算位置——这类文件不可能有未保存的修改。

### 1.6 `git status -uall` 的副作用（GIT-01）

`--untracked-files=all` 会把未跟踪目录展开成**每个文件一条**。被 `.gitignore`
忽略的文件仍不在其中（未加 `--ignored`），所以实际增量有限；但配合
`--ignored=matching` 时，忽略项也会逐个列出（`showIgnored` 开关的**行为**
不变，只是列表更细）。

### 1.7 查找弹窗的形态（FIND-01）

规格 §0.4 #4 拍板的是「**上下分栏**（列表 40% / 预览 60%）」，
§6.2 的示意图画的是左右分栏。按拍板结论实现为上下分栏，宽
`min(900px, 92vw)`、高 `min(640px, 80vh)`，复用 Quick Open 的骨架与
`z-index: 70`。

**实机反馈后的再次调整（见 §1.7.1）**：上半区改成**纯文件列表**
（一行一个匹配到的文件，带匹配数），下半区是该文件的**预览**
（它的每一处命中 + 前后各 5 行）。原先上半区按文件分组并把命中行直接
铺在文件行下面，结果是「文件行紧跟着该文件的命中行」，真正的预览被挤到
下面只剩一行——用户要的是「点文件 → 下面看这个文件」。

#### 1.7.1 弹窗的两半

| 区域 | 内容 | 交互 |
|---|---|---|
| 上半（40%） | **纯文件列表**：一行一个匹配到的文件（图标、文件名、目录、`N 处匹配`）。**不重复命中行** | 单击选中该文件；双击打开它的第一处命中；`↑↓` 切换文件 |
| 下半（60%） | **所选文件的预览**：该文件的每一处命中，各带前后各 5 行上下文，带行号，命中行高亮 | 双击某处命中 → 打开文件并定位到该行 |
| 底部 | 文件数与快捷键提示 | `Enter` 打开所选文件的第一处命中，`Esc` 关闭，`F8` / `Shift+F8` 切换文件 |

宿主侧的数据没有变动：`before` / `after` 上下文一直都在（实测 178/178 处命中
都带上下文），空的是**渲染**——上半区把命中行铺开后，预览区被挤到只剩一行。

### 1.8 设置页的一处真缺陷：整组设置没有标签（实机反馈）

**现象**：实机截图里【语义分析】组的每一行都**没有标签**——只有一个复选框、
一个下拉框、几个孤零零的数字框，看不出每个数字是什么。

**根因**（不是本轮引入的，但一直存在）：`src/client/SettingsPanel.jsx` 里这一组的
九行写成了

```js
React.createElement('Row', { label: ..., hint: ... }, ...)
```

——组件名被写成了**字符串**。React 于是渲染一个未知的 `<Row>` 元素：
`label` / `hint` 变成了不可见的 HTML 属性，只有控件留下来。本轮新增的两行用的是
正确的标识符（`createElement(Row, …)`），所以截图里**只有那两行有标签**——
这个反差正是定位的线索。

其它设置组（快捷键 / 终端 / 文件树 / 外部 IDE / 编辑器 / Git / 提交任务 / 外观）
一直写的是标识符，所以没有这个问题。

**修法**：九处 `'Row'` 改回 `Row`，并加一条回归测试
（`tests/settings-rows.test.mjs`）：客户端源码里**不允许**出现
`createElement('大写开头', …)`——组件名永远不是字符串。

### 1.9 设置页的排版与话术（实机反馈）

| 问题 | 改法 |
|---|---|
| 四个内存数字上下排开，每个占一整行，看起来稀疏 | 归成一个**字段块**（`SubGroup` + `Field`）：「内存与阈值」下四个字段并排，每个数字**头顶就是自己的标签**，长解释进 tooltip |
| 两个超时数字同样各占一整行 | 归成「超时与退出」字段块 |
| 语言服务器一行一个设置行，一屏全是「开关 + 命令」 | 改成紧凑的一行一个语言（`[✓] java  jdtls`），可换行 |
| 「当前可用内存 2850 MB； 预计需要 0 MB MB（可启动）／ 保守上限 256 MB MB」——**单位写了两遍**，且没打开项目时「预计需要 0 MB」毫无意义 | 单位只出现在模板里；没有打开项目时换成「当前可用内存 2850 MB · 尚未打开项目，暂无内存估算」；有项目时给出语言、估算值与**状态**（可启动 / 内存紧张 / 内存不足） |

**又一次割裂：字段块的输入框没被主题接管**。字段块用的是
`.iwb-settings-field-control`，而设置页给输入框上色的那条规则只写了
`.iwb-settings-control` —— 于是字段块的输入框**完全没被样式覆盖**，退回浏览器
默认外观：**黑框白底**，跟同一页上【编辑器】那些输入框完全不像。

修法：把那条规则的选择器列表扩成同时包含两个容器（`.iwb-settings-control`
与 `.iwb-settings-field-control`），宽度、字号、数字右对齐全部沿用同一套；
字段块里的输入框因此和其它行**一模一样**。回归测试
（`tests/settings-rows.test.mjs`）断言「字段输入框与行输入框由同一条规则上色」。

### 1.10 弹窗的按钮边界与话术（实机反馈）

**按钮边界**：`.iwb-textbtn` 的边框是 `--iwb-border`（一根发丝线），而弹窗
表面是 `--iwb-overlay` —— 两者几乎同色，**按钮看上去就是一行文字**。
现在给 `.iwb-modal-actions` 里的按钮单独一套：边框换成 `--iwb-border-strong`、
背景用 `--iwb-panel-2`（与弹窗表面差一层）、高度 30px、内边距 14px。
主按钮与危险实心按钮各自保留自己的颜色（`!important` 式的显式覆写，避免被
上面那条规则刷掉）。

**话术**：索引决策弹窗原来三句话、还和按钮重复（正文说「预计首次构建约 X」，
按钮又说「启用（预计 X）」），而且在语言未知时把 `the language server` 直接
拼进中文句子。现在：

| | 改前 | 改后 |
|---|---|---|
| 标题 | 为 X 启用语义分析**？** | 为 X 启用语义分析 |
| 正文 | 将启动 the language server 语言服务器并建立项目索引，预计首次构建约不到 1 分钟，占用内存约 0 MB。建立后可用语义补全、跳转定义与查找引用；不建立则只保留基础补全与文本查找。 | 将启动 **TypeScript** 语言服务器并建立项目索引，预计 2–5 分钟。 |
| 按钮 | 启用（预计 2–5 分钟）/ 不启用，仅基础功能 / 取消切换 | **启用** / **不启用** / **取消切换**（后两个的区别放进 tooltip） |

其它弹窗一并自查后收紧：

| 弹窗 | 改法 |
|---|---|
| 内存提醒（MEM-02） | 正文「当前可用 500 MB，TypeScript 预计需要 384 MB。」；按钮「仍然启动 / 使用基础模式」（原来是「降级为保守版」） |
| 诊断面板（MEM-03） | 去掉多余的「关闭」按钮（标题栏的 × 已经能关）；三个按钮「重新建立索引 / 使用基础模式 / 打开设置」；「健康度」改成「失败 / 超时次数」，0 时显示「无失败」 |
| 未保存修改警告（LAYER-01） | 文案与三个出口保持不变，按钮同样拿到新的边界 |
| 查找弹窗（FIND-01） | 结构已重做（文件列表 + 预览），标志按钮本来就带边框 |

### 1.11 内存数字能实时取到吗？代价多大（实测）

实机测量（本机，Windows）：

| 取数 | 代价 |
|---|---|
| `os.freemem()` + `totalmem()`（机器的可用内存） | **1.65 µs** |
| `detectLanguage()`（语言探测，6 次 `existsSync`） | **289 µs** |
| `manager.resources()` —— **没有**会话（要探测语言） | **593 µs** |
| `manager.resources()` —— 有会话（语言从会话取） | **9.7 µs** |
| `manager.status()`（宿主侧） | **4.8 µs** |
| 一次 loopback API 调用（fetch + http + json） | **2.03 ms** |
| 现有 2 秒轮询的总代价 | **0.1% 单核** |
| Windows：读子进程**实际**占用（`tasklist /FI "PID eq N"`） | **199 ms**（每次一个子进程） |
| Windows：同上（PowerShell `Get-Process`） | **429 ms** |
| Linux：读子进程实际占用（`/proc/<pid>/statm`） | 一次文件读（本机是 Windows，未实测） |

**结论**：

1. **估算要用的内存（`needMB`）与机器的可用内存：实时可取，几乎免费。**
   现在它们**跟着已有的 2 秒 `lsp.status` 轮询一起回来**（宿主侧多花 9.7 µs，
   传输零增量 —— 同一个响应里多带一个字段）。客户端按**兆字节**比较，只有数值
   真的动了才写状态，否则每 2 秒唤醒一次整个工作台只为换一个没变的数字。
2. **语言服务器的实际占用：现在取不到。** 宿主手里有子进程的 pid
   （`handle.pid`），但 Windows 上 Node 没有读进程工作集的接口，只能起子进程
   （`tasklist` 199 ms）—— **不能轮询**，只能**按需**（诊断面板打开时读一次）。
   Linux 上 `/proc/<pid>/statm` 是一次文件读，可以轮询。
   本轮**没有**加这个探测：它在 Windows 上是一次 199 ms 的子进程，用户没要求，
   而且按需读也够用（诊断面板要的是「刚刚的数字」）。

### 1.12 一处顺带修掉的负载相关缺陷（不属于本轮条目）
`identifierAt()` 原来用 `syntaxTree(state)` 取语法树。CodeMirror 的解析器是
**按时间预算**在后台推进的：机器繁忙时，光标附近的节点可能还没解析出来，
`syntaxTree()` 给的是一棵不完整的树，`resolveInner()` 于是落在别的节点上，
标识符取不到——`Ctrl+点击` 静默失效。

改成 `ensureSyntaxTree(state, pos, 1000)`：它保证树覆盖到请求的位置，答案
不再取决于机器负载。实测：4 个进程并发跑 `tests/definition.test.mjs`
共 120 次，修之前失败 5 次（约 4%），修之后 120 次全过；整包 `npm test`
连续 3 次 634/634。

**另一处同类抖动**：`tests/lsp-review-fixes.test.mjs` 的「三次无应答的请求会杀掉
语言服务器」用固定 `sleep(150)` 等看门狗的 25 ms 轮询，整包跑时偶尔红。
改成**等条件成立**（新增 `waitFor()` 助手 + 宿主快照里的 `timeouts` 计数），
不再靠猜时间；整包 `npm test` 连续 3 次 640/640。

> 这个缺陷与本轮的条目无关，是整包测试里唯一会偶发红灯的用例，顺手修掉了。

---

## 2. 代码检视轮（`docs/PRD-v5-代码检视报告-补充需求轮.md`）的处理结果

检视报告给出 20 条（R1–R20）。本轮逐条复核后**全部处理**：两条高危改了行为，其余改了话术、判定与布局。**两条与报告描述不一致的地方以代码为准**（见 §2.2）。

### 2.1 改了什么

| # | 问题 | 处理 |
|---|---|---|
| **R1** | 看门狗把「服务器静默」当成「请求未应答」→ 一条通知之后只要服务器安静 30 秒就算一次超时，三次就把服务器打死 | **改成数「未应答的请求」**：worker 报告哪些载荷是请求（带 id 和 method）、哪些是应答（带 id、没有 method），宿主维护未决请求表；只有真正超时的**请求**才计数。通知永远不计数 |
| **R2** | 客户端握手失败后 `initializing` 永久 rejected → 之后每个请求都失败，只能刷新页面 | 会话现在**看着握手**：失败后断开并重连（最多 3 次，每次隔 2 秒），并补了用例 |
| **R3** | 全局「内存上限」是**死控件**，永远到不了 worker | 全局值进入生效链：`每语言覆盖 ?? min(语言默认值, 全局上限)`。全局值是**上限**（只能压低，单个语言可以用覆盖值调高） |
| **R4** | 客户端与宿主对同一份快照给出相反结论；低内存 toast 用错字段 | 宿主随快照下发**权威结论** `decision`（`ok` / `tight` / `low`），客户端只渲染不再自己判断；toast 改用**门槛**（`thresholdBytes`）而不是估算值 |
| **R5** | `memoryWarnedRoots` 只记「问过了」，不记用户的选择 | 改记**选择**（`accepted` / `conservative`）：`accepted` → 直接强制启动，`conservative` → 直接走保守模式，两种都不再问 |
| **R6** | `settings.update()` 不跑迁移 | 默认值收敛到**一个模块**（`src/host/settings-defaults.js`，宿主与客户端共用），「重置」读的是同一个对象 |
| **R7** | 崩溃原因被硬编码为「内存不足」 | 宿主只报**事实**（`The language server exited unexpectedly (3 request timeouts).`），**建议由客户端按原因分派**：超时 → 调高「单次请求的上限」；内存 → 关闭其它程序或改用保守版 |
| **R8** | 低内存提示指向无效控件 | 改为「请关闭其它程序，或对该语言改用保守版」 |
| **R9** | 同屏两个「保守下限」（512 与 256） | 动态行改称「**硬下限**」，并补上「低于 {threshold} MB 不启动」 |
| **R10** | 「重置」不重置语义分析设置 | 重置补上 `lsp` 段（三个映射用 `null` 送出去，否则合并会留下旧值） |
| **R12** | 语法色板只按浅底调校，深底 2.58–3.98:1（比旧色板更差） | 十个令牌改成**随主题**：`color-mix(in oklab, <色相> 52%, var(--iwb-fg) 48%)`。最差情况 **5.12:1**（旧色板 2.58:1），测试改成**双底 + 通用对比度公式**，并用 CSS 规范的 oklab 参考值校验换算 |
| **R13** | 单击文件行后 Esc / ↑↓ / F8 全部失效 | 键盘处理移到**弹窗容器**（`tabIndex={-1}`），焦点在哪都生效 |
| **R14** | 「全项目查找」继承「查找用法」的查询词与 wholeWord，并自动重搜 | 打开时**重置查询词与三个开关**；弹窗每次打开都从 store 重新取种子 |
| **R15** | 查找跳转丢掉列号 | 列号一路传到 `revealColumn`（弹窗 → `openSearchResult(rel, line, column)` → `openFile`） |
| **R16** | 无上游时推送按钮**永久禁用**，规格要求的「提示 + 可复制命令」不可达 | 按钮不再禁用（没有待推送的提交时也不禁用），点击 → toast 给出命令**并带一键复制** |
| **R17** | `-uall` 叠加 2 秒轮询，没有规模保护 | `parseStatusV2` 有**条目上限**（20000）且逐条读取不再 `split('\0')`，超限截断并上报；实测见 §2.3 |
| **R18** | 切换项目时旧语言服务器只断连接、不停进程 | 切换项目时对**旧 root** 调用 `lsp.shutdown`，旧进程立即退出 |
| **R19** | 新增测试保真度有缺口 | 层级测试补了**渲染后**的用例（两个弹窗同屏、确认框可答）；查找测试补了三条关闭路径与**真实点击**（不再是只调 `moveSearchSelection`）；主题测试改双底断言 |

### 2.2 与报告描述不一致、以代码为准的两处

1. **R1 的机制被报告写反了。** 报告说「通知刷新了时间戳 → 服务器显得沉默 → 记超时」。实际相反：通知**刷新**时间戳反而**阻止**超时（`now - lastClientActivityAt < timeout` 直接返回）。真正的缺陷是**另一面**：一条通知之后服务器安静 30 秒（构建期常见），看门狗就把这记成一次「请求超时」——**根本没有请求**。两者的修法一致（数请求，不数沉默），但复现与用例必须按后者写。
2. **R2 的「下限 30 秒不可调」在界面上不成立。** 设置项的输入框有 `min: 30000`，运行时的下限也是 30000，两边一致；本次只是把显示值也钳到下限，运行时**低于** 30000 的值（手改配置文件）仍会被抬到 30000。真正的问题是握手失败后的**粘性损坏**，那一半修了。

### 2.3 规格 §11 风险 #1 的实测（`-uall` 的代价）

仓库：临时目录里 20000 个未跟踪文件（200 个目录），`git init` + 一次提交，测完删除（工作区未受影响）。机器：Windows，git 2.47.1。

| 测什么 | 数字 |
|---|---|
| `git status --porcelain=v2 --branch -z --untracked-files=all` | 177 / 155 / 144 / 134 / 126 ms → **中位数 144 ms**（最坏 177 ms） |
| 该输出的体积 | 0.55 MiB |
| `parseStatusV2` 处理 20000 条 | 11 ms（上限 1000 时 1 ms，截断） |
| 宿主快照（`status()`，不含 numstat） | 205 ms |
| 宿主快照（含 numstat） | 319 ms |

**结论**：20000 个未跟踪文件时状态调用仍在规格要求的 300 ms 以内，解析开销可以忽略。
上限（20000 条）是**安全网**，不是绕开实测结论的补丁。

### 2.4 报告里已经确认没有问题的部分

LAYER-01 的层级关系（z-index 50 / 55）、USAGE-01 `requestFile` 的四项要求、GIT-01 的着色逻辑、SET-01 关闭开关即退进程的主路径——报告逐条复核通过，本轮未改。

---

## 3. 关键实现决定

| # | 决定 | 理由 |
|---|---|---|
| 1 | 索引决策弹窗在**根目录**下三个按钮**权重相同**（都不带 `iwb-primary`），非根目录下「启用」是唯一主按钮 | 规格 §0.4 #7：根目录没有推荐项，把「不推荐」做成主按钮是错的 |
| 2 | 「取消切换」在**两种**场景下都提供 | 规格 §0.4 #7；此前非根目录只能「切过去但不建索引」 |
| 3 | 关闭「构建代码索引」时先 `lsp.shutdown` 再断 WebSocket | 顺序保证日志可读；`shutdown` 按 root 找会话，即使当前 root 已空也有效 |
| 4 | `memoryWarnedRoots` 写在设置文档里（`settings.lsp`），不是会话状态 | 「同一项目不再重复问」要跨重启成立；存的是**选择**（R5） |
| 5 | 诊断面板的内存与 stderr **随状态轮询**回来（宿主在同一个响应里带上），不再单独请求 | 每 2 秒一次请求太贵；宿主侧只要 9.7 µs（见 §1.11） |
| 6 | 状态栏的「重新建立索引」按钮只在 `degraded` / `failed` / `cancelled` 出现 | 从未建过索引的项目（`idle`）保持干净的状态栏，它的入口是诊断面板 |
| 7 | 搜索弹窗复用 `state.search` 切片，`textMatch` 区分标题 | 规格 §0.4 #5：两个入口共享一份数据，但标题不同 |
| 8 | 宿主侧的 `lsp.servers` 增加 `memoryBaselineMB`，设置页据此显示每个语言的估算 | 规格 SET-03 的动态说明 |
| 9 | 查找弹窗用「打开代数」做 `key`，每次打开都重新挂载 | 弹窗挂载时从 store 取查询词，重新挂载就不会出现「上一轮的查询词」闪一下 |
| 10 | `identifierAt` 改用 `ensureSyntaxTree` 而不是 `syntaxTree` | 见 §1.12：机器繁忙时语法树还没解析到光标，标识符取不到，`Ctrl+点击` 会静默失效 |
| 11 | 内存阈值的**判定收敛到宿主**：快照带一个 `decision`，客户端只渲染 | 见 §2.1 的 R4：两边各判一次就会给出两个答案 |
| 12 | 语言服务器的默认参数收敛到 `src/host/settings-defaults.js`（宿主与客户端共用） | 见 §2.1 的 R6/R10：两份副本迟早会漂 |

---

## 4. 交付物清单（规格 §12）

| # | 交付物 | 位置 | 状态 |
|---|---|---|---|
| 1 | 宿主：内存估算模型与分级阈值 | `src/host/lsp.js` | ✅ |
| 2 | 宿主：`lsp.start` 支持 `force`、返回估算字段 | `src/index.js`、`src/host/lsp.js` | ✅ |
| 3 | 宿主：未跟踪文件粒度 | `src/host/git.js` | ✅ |
| 4 | 宿主：搜索结果带上下文 | `src/host/search.js` | ✅ |
| 5 | 客户端：workspace 的 `requestFile` 与内容缓存 | `src/client/lsp-workspace.js` | ✅ |
| 6 | 客户端：语义健康度计数与状态栏合成 | `src/client/lsp-session.js`、`src/client/store.js`、`src/client/Workbench.jsx` | ✅ |
| 7 | 客户端：重新建立索引 / 降级为保守版 | `src/client/store.js`、`src/client/Workbench.jsx` | ✅ |
| 8 | 客户端：索引决策弹窗精修 + 内存提醒弹窗 | `src/client/Workbench.jsx`、`src/client/styles.js` | ✅ |
| 9 | 客户端：查找结果弹窗 | `src/client/SearchPopup.jsx`（新）、`src/client/store.js`、`src/client/EditorArea.jsx` | ✅ |
| 10 | 客户端：独立推送按钮 + 可点的 `↑N` | `src/client/CommitPanel.jsx`、`src/client/Workbench.jsx` | ✅ |
| 11 | 客户端：弹窗层级修正 | `src/client/ui.jsx`、`src/client/styles.js` | ✅ |
| 12 | 样式：主题令牌化 | `src/client/styles.js`、`src/client/CodeEditor.jsx` | ✅ |
| 13 | 设置项与文案 | `src/client/SettingsPanel.jsx`、`src/host/settings-store.js`、`src/client/i18n.js` | ✅ |
| 14 | 测试 | `tests/**` | ✅ |

---

## 5. 新增测试

| 文件 | 覆盖 | 用例数 |
|---|---|---|
| `tests/lsp-memory-policy.test.mjs` | 新的估算模型：YAML 在 300 MB 可用内存下 `canIndex === true`；紧张区间返回 `tight`；< 256 MB 拒绝；`needMB` 与 `thresholdBytes` 一致；`freeMemoryThresholdMB` 不再是硬门槛；**全局上限真的到达了 worker**（断言注入握手的那一个值） | 26 |
| `tests/lsp-usage-references.test.mjs` | `requestFile`：未打开的文件也能返回文档；项目外返回 `null` 且不弹 toast；缓存生效；跨文件位置可映射 | 11 |
| `tests/lsp-health-status.test.mjs` | 连续失败计数、超时单独计数、成功归零、只有语义请求被计数；**握手失败后会话能恢复**；**切换项目会停掉旧服务器** | 14 |
| `tests/lsp-restart.test.mjs` | `restartLsp()`：先 `shutdown` 后 `start`；`degradeLsp()` 只停不启；宿主失联时不崩 | 5 |
| `tests/lsp-review-fixes.test.mjs` | 看门狗按**请求**计数：一条通知之后服务器安静下来**不算超时**（R1） | 22 |
| `tests/git-untracked-files.test.mjs` | `-uall` 的状态解析；尾斜杠目录条目走 `dirs`；全局 `status.showUntrackedFiles=normal` 也不折叠；**状态条目有上限**（R17） | — |
| `tests/search-context.test.mjs` | 命中带上下文、二进制命中无上下文、预算裁剪、2000 命中仍在 2 MB 内 | — |
| `tests/search-popup.test.mjs` | 查找弹窗：打开不新增 tab；**三条关闭路径**（Esc / 遮罩 / ✕）；**真实点击**文件行只选中、双击跳转并带上**列号**；单击后键盘仍然可用；两个入口互不串味（R13/R14/R15） | 21 |
| `tests/modal-layer.test.mjs` | 未保存修改警告的 z-index 高于项目选择框；确认框与项目选择框**同屏渲染**且可作答 | 5 |
| `tests/styles-theme.test.mjs` | 样式表扫描：不存在 `#1b1e24`、`#d8dce3`、`#7fb8ff`、`rgba(255,255,255`；`--iwb-on-accent` 是深色；**语法色在浅底与深底上都 ≥ 4.5:1**（通用对比度公式 + oklab 换算用 CSS 规范的参考值校验） | 14 |
| `tests/idx-decision.test.mjs` | 索引决策的按钮与话术；**内存紧张时先问用户**、**记住用户的选择**、**内存不足时用门槛而不是估算值**（R4/R5） | 25 |

---

## 6. 仍需人工走查（自动化覆盖不到）

规格 §10.4 的清单逐条对应：

- [ ] 浅色主题下悬停一个带 JSDoc 代码块的函数：卡片里没有纯黑块。
- [ ] 浅色主题下打开补全弹窗：选中行清晰，详情行不糊。
- [ ] 索引决策弹窗：三个按钮的主次正确；非根目录下「取消切换」真的不切项目。
- [ ] 内存紧张时切项目：弹窗出现，两个出口都可用；同一项目不重复弹。
- [ ] 连续制造几次语义失败：状态栏从「就绪」变「不稳定」，点它能打开诊断面板。
- [ ] 保守版状态下点状态栏 → 「重新建立索引」→ 恢复到「就绪」，不用切项目。
- [ ] 关掉「构建代码索引」→ 5 秒内语言服务器进程消失（任务管理器可查）。
- [ ] 语义查找用法：跨文件的引用都能列出来，点一条能跳过去。
- [ ] 未跟踪目录下的每个文件都着色；目录色随子文件。
- [ ] 双击未跟踪目录条目：不出现英文错误。
- [ ] `Ctrl+Shift+R`：弹窗出现，**标签页区不新增标签**；单击预览、双击跳转并关闭。
- [ ] 提交后不推送：Commit 面板「推送」按钮可点，推送后 `↑N` 消失。
- [ ] 切换项目时有未保存修改：警告框**在**项目选择框之上，看得见也点得到。

---

## 7. 回归清单（规格 §11）的处置

| # | 风险 | 处置 |
|---|---|---|
| 1 | `git status -uall` 在超大仓库变慢 | 已上 `-uall` + `-c` 覆盖；`node_modules/` 等被忽略的目录不计入。**待实机在 2 万文件的仓库上量一次**（规格验收项） |
| 2 | 新门槛更宽松，可能更早 OOM | `memoryLimitMB` 继续作为上限注入 `maxTsServerMemory`；崩溃后仍走 `autoRestart` |
| 3 | `requestFile` 一次查找读几十个文件 | 按 uri 缓存，容量 64，`textDocument/references` 一开始即清空 |
| 4 | 引用面板一次列几百条 | 沿用库自带的面板滚动 |
| 5 | 查找结果结构扩了 `before`/`after` | 每文件命中上限 200 条带上下文，总量超 2 MB 时**从后面的命中开始**裁剪上下文，最后才缩短预览 |
| 6 | 状态栏新增 `warn` 态与 `building` 撞车 | 文案区分：「不稳定（连续失败 N 次）」vs「索引中…」 |
| 7 | 关闭开关时多一次 `lsp.shutdown` | 只在 `enabled` 由 true→false 时调用；失败只记日志 |
| 8 | 弹窗抢快捷键 | 弹窗打开时输入框自行处理 `Esc` / `↑↓` / `Enter` / `F8`；全局 `F8` 分支先看弹窗是否打开 |
| 9 | 查找从 tab 改成弹窗 | `F8` / `Shift+F8` 在弹窗内继续循环命中；快捷键不变 |
| 10 | 弹窗遮罩与 modal 同为 `position: absolute` | 沿用 Quick Open 的 `z-index: 70`，不复用 50 |
| 11 | 语法色板改动影响编辑器观感 | fallback 色逐类在浅底上验过（`tests/styles-theme.test.mjs` 断言 ≥ 4.5:1） |
| 12 | `lsp.enabled` 改标签但不改字段 | 字段不变、只改文案；CHANGELOG 已写明「该开关即构建代码索引」 |
