# PRD-v5 补充需求 —— 智能代码体验收尾、Git 着色与交互形态

> **状态**：**已实施**。落地产物与偏差记录见 `docs/PRD-v5-补充需求-实施进展.md`（本文件仍是规格，不覆盖它）。
> 规格已按实机反馈逐条核实（每条都给了代码锚点），§0.4 的决策**已全部拍板**（按默认结论执行，无需再确认），**开发时按本文执行**。
> **输入**：一次实机使用的口头反馈，共 10 组条目（智能代码 6 条 + 文件树 Git 着色 + 全项目查找 + Commit 推送 + 弹窗层级）。
> **配套**：`docs/PRD-v5.md`（V5 主规格，只读）、`docs/PRD-v5-缺陷跟踪.md`（D1–D17 的缺陷与修复）、`docs/PRD-v5-代码检视报告.md`（五轮检视记录）、`docs/PRD-v5-实施进展.md`（落地与偏差）。
> **代码基线**：`dsh-ide-workbench` commit **`13c4533e729042a2e8a92526028e20ec2852edf3`**（分支 `main`，`docs(code): record the fourth and fifth review rounds`，2026-10-31）。基线测试 **549 项 / 549 通过 / 0 失败**。
> **本文档定位**：这是**实施规格**，不是问题清单。每一项都含：核实结论 → 代码锚点（`file:line`）→ 改法 → 验收口径 → 风险。
>
> ⚠️ **与前几轮检视/修复的关系**：本轮反馈里的「配色」「弹窗层级」「查找用法」三处**不是**新问题，但在前几轮里**没有被真正修掉**——D9 修的是「看不清」，本轮反馈说的是「看清了但丑」；D1–D17 修的是 LSP 协议层的崩溃与超时，本轮反馈说的是**协议层之上**的产品行为。§0.2 有一张逐条对照表，开工前先读它，避免重复劳动或误判「已修」。

---

## 0. 一页速览

### 0.1 本轮条目一览

| ID | 条目 | 类型 | 优先级 | 核心锚点 | 一句话验收 |
|---|---|---|---|---|---|
| THEME-01 | 悬停卡片 / 签名帮助去掉硬编码黑白 | 观感 | **P0** | `styles.js:1123-1130` | 浅色宿主主题下，悬停卡里不再出现纯黑代码块；全部取自 `--dsw-alias-*` |
| THEME-02 | 补全弹窗 / 引用面板跟随宿主 | 观感 | **P0** | `styles.js:1042-1090`、`1144-1159` | 选中行、详情行、引用面板不出现硬编码 `#fff` / `rgba(255,255,255,.82)` |
| THEME-03 | 代码块与语法高亮的取色策略 | 观感 | **P1** | `CodeEditor.jsx:126-140` | 语法色板随宿主明暗切换，不再固定为暗色系 |
| THEME-04 | 索引决策弹窗的布局与话术精修 | 观感 | **P1** | `Workbench.jsx:563-623` | 弹窗有主次按钮、耗时与内存预估；文案不再用「索引」这个误导词 |
| MEM-01 | 内存门槛从「一刀切 2GB」改为按语言估算 | **缺陷** | **P0** | `host/lsp.js:1047-1058` | YAML 项目在可用内存 300 MB 时可以启动语言服务器，不再被 2GB 门槛拦死 |
| MEM-02 | 内存不足时先提醒、让用户决定 | 体验 | **P0** | `host/lsp.js:1175-1179` | 低于软阈值时弹窗给出「仍然启动 / 降级为保守版」两个出口 |
| MEM-03 | 降级状态必须可见（修「静默失效」） | **缺陷** | **P0** | `Workbench.jsx:326-332`、`lsp-session.js:75-93` | 连续语义请求失败后状态栏不再显示「就绪」，改显「不稳定」并给出诊断入口 |
| MEM-04 | 降级后必须能重新建立索引 | 体验 | **P0** | `Workbench.jsx:366-368` | 保守版状态下点状态栏即有「重新建立索引」，不需要切换项目 |
| USAGE-01 | 修复语义版「查找用法」几乎为空 | **缺陷** | **P0** | `lsp-workspace.js:196-434` | 引用分布在未打开文件里时，查找用法仍能列出全部命中 |
| SET-01 | 索引总开关语义收敛 + 关闭即退进程 | 体验 | **P0** | `lsp-session.js:355-381` | 关掉开关后宿主侧语言服务器进程立即退出，内存归零 |
| SET-02 | 补齐按语言启停（代码检视报告 N7） | 体验 | **P2** | `SettingsPanel.jsx:382-462` | 设置页能单独关掉某一个语言 |
| SET-03 | 内存阈值参数改造为「基线 + 余量」 | 体验 | **P1** | `host/lsp.js:104-115` | 阈值参数不再是「2GB 硬门槛」，默认值下调且语义写进设置说明 |
| GIT-01 | 未跟踪文件以**文件**为粒度着色 | **缺陷** | **P0** | `host/git.js:269` | 未跟踪目录下的每个文件都着色，目录色由子文件聚合而来 |
| GIT-02 | Commit 面板的目录条目可展开 | 体验 | **P1** | `CommitPanel.jsx:153-156` | 双击未跟踪目录不再报英文「path is a directory」，而是展开成文件列表 |
| FIND-01 | 全项目查找 / 查找用法从标签页改为弹窗 | 体验 | **P0** | `store.js:1882-1940` | 查找结果在独立弹窗中呈现，代码标签页不再被占用 |
| FIND-02 | 查找结果弹窗的预览与跳转 | 体验 | **P0** | `host/search.js:103-115` | 单击命中 → 下方预览上下文；双击 → 打开文件并定位 |
| PUSH-01 | Commit 面板补独立「推送」按钮 | 缺口 | **P0** | `CommitPanel.jsx:288-299` | 提交之后能在界面里推送落后的提交，不需要开终端 |
| PUSH-02 | `↑N` 徽标可点并带状态说明 | 体验 | **P1** | `Workbench.jsx:84-86` | 顶栏 `↑N` 可点，弹出推送菜单并说明「领先 N 个提交」 |
| LAYER-01 | 未保存修改警告必须高于「选择 IDE 项目」 | **缺陷** | **P0** | `Workbench.jsx:779-787` | 切换项目时未保存警告盖在项目选择框之上，看得见也点得到 |

### 0.2 与前几轮检视 / 修复的逐条对照

| 实机反馈条目 | 前几轮是否处理过 | 结论 |
|---|---|---|
| 配色太丑（黑白、复古） | D9 修过「文字看不清」（`0b20f16`），但那轮的修法是**硬编码一套暗色代码块**（`styles.js:1123-1130`），把「看不清」变成了「看不顺眼」 | **不是重复**。本轮换成「跟随宿主配色」的解法，THEME-01/02 要把 D9 引入的硬编码色值换掉 |
| 索引决策弹窗不好看 | 从未处理过。IDX-03 只定义了「问什么、给哪几个按钮」 | **全新条目**（THEME-04） |
| 降级了但状态栏仍显示「就绪」 | D7 修的是「语言服务器静默死亡不被察觉」（宿主侧进程死亡）；D3 修的是 `Ctrl+点击` 超时。**请求超时 → 状态栏**这条链路从未存在过 | **不是重复**，是新缺陷（MEM-03） |
| 内存 2GB 一刀切 | PRD-v5 §2.2 / IDX-02 设计如此，从未质疑过 | **不是重复**，是设计缺陷（MEM-01/02/03） |
| 降级后无法恢复 | 从未处理过。`lsp.shutdown` 路由存在（`src/index.js:512`）但客户端从不调用 | **全新条目**（MEM-04） |
| 设置里加索引开关 | `lsp.enabled` 开关**早已存在**（`SettingsPanel.jsx:383-389`，默认开启），且关闭后确实不再询问、也不再连接（`store.js:1038`、`lsp-session.js:366-380`） | **部分重复**。用户没找到它 → 见 SET-01：不是新增开关，而是**收敛语义 + 补进程退出 + 让它可见** |
| 查找用法（语义）不可用 | 从未处理过。D3/D7 修的是定义跳转与崩溃，不是引用查找 | **全新缺陷**（USAGE-01），根因已定位到 `requestFile` |
| 未跟踪目录只有目录着色 | 从未处理过 | **全新缺陷**（GIT-01） |
| 全项目查找占用代码标签页 | PRD-v4 之后一直是标签页形态（`EditorArea.jsx:753-763`） | **全新条目**（FIND-01/02） |
| 提交后没有地方 push | 宿主 / 路由 / store 三层都有 `push`，**只有 UI 没有按钮** | **全新缺口**（PUSH-01），实现成本低 |
| 切换项目时未保存警告看不见 | 从未处理过 | **全新缺陷**（LAYER-01） |

### 0.3 本轮非目标

- **不做 AI 内联补全（FIM）**。仍是 PRD-v5 §0.3 的立场。
- **不做 LSP 重命名 / 格式化**。仍与 `F2`、`Shift+F6` 冲突（PRD-v5 §0.2 #6）。
- **不做精确的内存预测**。内存占用与仓库规模、语言、TS 版本强相关，不可能精确预测；本轮做的是**分级阈值 + 估算基线**（MEM-01），不是预测器。
- **不做 `git pull` / `git fetch`**。本轮只补「推送」（PUSH-01）。拉取涉及冲突合并，是另一件事。
- **不改 DSH 宿主源码**。配色全部靠宿主**已经暴露**的 `--dsw-alias-*` CSS 变量跟随，不新增宿主接口（见 §1.1）。
- **不重写 `@codemirror/lsp-client`**。引用面板、悬停卡片、补全弹窗都继续用库渲染，只改主题与接入方式（USAGE-01 只补一个 `requestFile` 覆写）。

### 0.4 决策回填表（**已拍板**，开发时按此执行）

> 本表已按默认结论定稿，**不再需要二次确认**；开发时按「结论」列实现，验收时按「影响」列自查。

| # | 决策项 | 结论（已拍板） | 影响 |
|---|---|---|---|
| 1 | 语义索引开关的呈现 | **复用现有 `lsp.enabled`**，**改标题**为「构建代码索引」并加一行说明「关闭后不启动任何语言服务器，切换项目不再询问」。**不新增** `lsp.indexEnabled` 字段 | 不破坏已有配置文件；避免 schema 再升一版 |
| 2 | 内存阈值系数 | **启动阈值余量 1.5**（`needMB = baselineMB × 1.5`）；**软提醒阈值 2.0**（`freeMB < needMB × 2.0` 进入「紧张」区间，弹窗询问）；**硬下限 256 MB** | 决定「能不能启动」的松紧度：YAML 需 96 MB、TypeScript 需 384 MB，与 2 GB 门槛相比放宽约一个数量级 |
| 3 | 语义请求连续失败几次算「不稳定」 | **3 次**；或**连续 2 次超时**（超时单独计，因为它是最典型的静默失效） | 状态栏变色的灵敏度；过敏会让正常的大项目误报 |
| 4 | 查找结果弹窗的形态 | **顶部浮出式**，复用 QuickOpen 骨架与 `z-index: 70`；宽 `min(900px, 92vw)`、高 `min(640px, 80vh)`；**上下分栏**（列表 40% / 预览 60%） | 比居中 modal 更接近 IDE 习惯，且不遮挡状态栏；`z-index 70` 高于所有 modal（§11 风险 #10） |
| 5 | 「查找用法（文本）」是否保留标签页形态 | **不保留**——两个入口（`search:in-files` / `search:usages`）**都改成弹窗**；`state.search` 仍是单一切片，靠 `textMatch` 区分标题 | 消除「两个 tab 共享一份数据、互相覆盖查询」的老问题 |
| 6 | 未跟踪文件着色是否影响 `.gitignore` 命中的目录 | **不影响**——忽略项仍走 `settings.project.showIgnored` 开关，行为不变 | 无 |
| 7 | 索引决策弹窗的按钮集合 | **根目录**：三个按钮**同级**（无推荐项）；**非根目录**：「启用」为主按钮，并**补一个「取消切换」**（不切项目） | 消除「不推荐项被做成主按钮」与「用户以为取消了但项目还是切了」 |

---

## 1. THEME —— 智能代码配色跟随宿主

### 1.1 事实核实（先读，否则会重复造轮子）

**好消息：宿主配色已经暴露了，插件主体也已经在用。**

`src/client/styles.js:11-38` 已经把宿主的设计系统令牌封装成插件自己的变量：

```css
--iwb-bg:    var(--dsw-alias-bg-base, #15171c);
--iwb-panel: var(--dsw-alias-bg-layer-1, #1b1e24);
--iwb-overlay: var(--dsw-alias-bg-overlay, #262b34);
--iwb-border: var(--dsw-alias-border-l1, #2c313a);
--iwb-fg:    var(--dsw-alias-label-primary, #d8dce3);
--iwb-muted: var(--dsw-alias-label-secondary, #8a93a1);
--iwb-accent: var(--dsw-alias-brand-primary, #4c9aff);
--iwb-error: var(--dsw-alias-state-error-primary, #e2686f);
```

`--dsw-alias-*` 是 **DSH 宿主自己的设计系统别名**，随宿主明暗主题实时变化；`var(--x, fallback)` 的 fallback 只在宿主没提供时生效。**「跟随宿主配色」这件事不需要任何宿主改造，只需要不再硬编码。**

**坏消息：智能代码相关的控件恰恰是硬编码最集中的地方。**

`src/client/styles.js:1123-1130`（D9 那轮引入）：

```css
.iwb-codemirror .cm-lsp-documentation pre,
.iwb-codemirror .cm-lsp-documentation code,
.iwb-codemirror .cm-lsp-signature {
  font-family: var(--iwb-mono);
  background: #1b1e24 !important;   /* ← 写死的暗色 */
  color: #d8dce3 !important;        /* ← 写死的亮色 */
  border-radius: 4px;
}
```

这一条就是用户说的「暴力黑白配色」的**直接来源**：无论宿主是浅色还是深色，悬停卡片里的 JSDoc 代码块永远是一块纯黑 `#1b1e24`。浅色主题下，一张浅色卡片中间突然嵌一块纯黑，这就是图 1 底部那段「复古」观感的来源。

其余硬编码色值：

| 位置 | 硬编码值 | 出现在 |
|---|---|---|
| `styles.js:1067`、`:1069` | `#fff` | 补全弹窗选中行文字 |
| `styles.js:1078` | `rgba(255,255,255,.82)` | 选中行的详情文字 |
| `styles.js:1072` | `var(--iwb-bg)` | 禁用态选中行文字（这个是对的） |
| `styles.js:1155`、`:1157`、`:1159` | `#fff` / `rgba(255,255,255,.82)` | 引用面板选中行 |
| `styles.js:1140` | `#7fb8ff` | 签名帮助的当前参数 |
| `CodeEditor.jsx:158` | `rgba(76,154,255,.24)` | 选区 |
| `CodeEditor.jsx:159` | `rgba(76,154,255,.25)` / `rgba(76,154,255,.5)` | 匹配括号 |
| `CodeEditor.jsx:160` | `rgba(215,162,74,.28)` | 搜索命中 |
| `CodeEditor.jsx:161` | `rgba(76,154,255,.45)` | 选中的搜索命中 |
| `CodeEditor.jsx:126-140` | `#7a8596` / `#5f8f3f` / `#a15fb0` / `#b57a2a` / `#2f8f83` / `#8a6a1f` / `#3f6f9f` / `#c05a63` / `#3b7dd8` / `#e2686f` | **整套语法高亮色板**（暗色系） |

**关键前提**：库的 `baseTheme` 只定义间距、不定义颜色（`node_modules/@codemirror/lsp-client/dist/index.js:294-300` 只写了 `margin`），所以**每一个颜色都由插件自己决定**——改造完全可控，不存在「库赢了特异性」的阻碍。

库的 DOM 结构（改造时要对齐的锚点）：

| 元素 | 类名 | 位置 |
|---|---|---|
| 悬停卡 | `.cm-tooltip.cm-lsp-hover-tooltip.cm-lsp-documentation` | `lsp-client/dist/index.js:1071` |
| 签名帮助 | `.cm-tooltip.cm-lsp-signature-tooltip` | `:1384` |
| 签名帮助的文档区 | `.cm-lsp-signature-documentation.cm-lsp-documentation` | `:1421` |
| 引用面板 | `.cm-lsp-reference-panel` | `:1660` |
| 补全信息面板 | `.cm-tooltip.cm-completionInfo` | — |

> 注意：悬停卡元素**同时**带 `cm-lsp-hover-tooltip` 和 `cm-lsp-documentation` 两个类，所以 `.cm-lsp-documentation p` 这类选择器对悬停卡里的段落是生效的；样式表注释（`styles.js:1093-1096`）也记着「早期版本按 `.cm-lsp-hover` 选，一个都没匹配上」的教训。

### 1.2 THEME-01 — 悬停卡片 / 签名帮助去掉硬编码黑白

**改法**

1. 把 `styles.js:1123-1130` 的 `background: #1b1e24` / `color: #d8dce3` 换成一组**跟随主题的代码块令牌**。在 `styles.js:11-38` 的变量块里新增：

   ```css
   --iwb-code-bg: var(--dsw-alias-bg-layer-2, #232830);
   --iwb-code-fg: var(--dsw-alias-label-primary, #d8dce3);
   --iwb-code-border: var(--dsw-alias-border-l1, #2c313a);
   --iwb-code-muted: var(--dsw-alias-label-secondary, #8a93a1);
   --iwb-on-accent: var(--dsw-alias-label-on-brand, #ffffff);
   ```

   > 取值口径：**代码块用「比正文更深/更浅一档的层」**，而不是「永远是深色」。浅色主题下代码块应是浅灰底 + 深字，深色主题下是深灰底 + 浅字。这样代码块在任何主题下都和卡片有层次，又不会割裂。
   > `--dsw-alias-label-on-brand`（品牌色上的文字色）若宿主未提供则回退 `#ffffff`，这一项本来就是安全的。

2. `styles.js:1140` 的 `#7fb8ff` → `var(--iwb-accent)`（当前参数高亮用品牌色即可，不需要另一支蓝）。
3. `styles.js:1067`、`:1069`、`:1078`、`:1155`、`:1157`、`:1159` 的 `#fff` / `rgba(255,255,255,.82)` → `var(--iwb-on-accent)` / `color-mix(in srgb, var(--iwb-on-accent) 82%, transparent)`。
   > 若宿主不支持 `color-mix`（老 Electron），退化为 `rgba(255,255,255,.82)` 的同时**必须**在浅色主题下也成立——因为这些文字只出现在品牌色实心背景上（选中行），白字在浅色品牌色上对比度不足。稳妥做法：选中行背景用 `var(--iwb-accent)`，文字用 `var(--iwb-on-accent)`；若 `--iwb-on-accent` 未定义，回退到 `#0d1117`（深色）而非 `#ffffff`，由宿主决定品牌色深浅。

**验收口径**

- 宿主切到**浅色**主题，悬停一个 TS 函数（带 JSDoc `@example` 代码块）：卡片内**不存在** `#1b1e24` 纯黑块；代码块底色与卡片底色可分辨且文字清晰。
- 宿主切到**深色**主题，悬停同一函数：代码块仍是「深一档」的底色，文字清晰。
- 自动化断言：样式表里**不再出现** `#1b1e24`、`#d8dce3`、`#7fb8ff`、`rgba(255,255,255` 这四个具体值（`styles.js` 全文扫描）。

### 1.3 THEME-02 — 补全弹窗 / 引用面板跟随宿主

**改法**

1. 补全弹窗（`styles.js:1042-1090`）除选中行外全部已用 `--iwb-*`，只需按 §1.2 替换选中行那三处 `#fff`。
2. 引用面板（`styles.js:1144-1159`）同上。
3. 补一条**通用兜底**：`.iwb-codemirror .cm-tooltip *` 已经是 `color: inherit`（`styles.js:1039`），补一条 `background: transparent` 兜底，防止库自身某个元素带白底漏出来。
4. `.iwb-codemirror .cm-tooltip` 的 `box-shadow: 0 8px 24px rgba(0,0,0,.32)`（`styles.js:1037`、`:1047`、`:1107`）在浅色主题下偏重，改为 `0 8px 24px var(--iwb-shadow, rgba(0,0,0,.32))`，并在变量块新增 `--iwb-shadow: var(--dsw-alias-shadow-1, rgba(0,0,0,.32))`（宿主没给就保持现状）。

**验收口径**

- 浅色 / 深色两种主题下，补全弹窗与引用面板均无「浅色卡片里漏出白块」或「深色卡片里漏出黑块」。
- 选中行在两种主题下都满足可读（文字与背景对比度 ≥ 4.5:1）。

### 1.4 THEME-03 — 代码块与语法高亮的取色策略

`CodeEditor.jsx:126-140` 的 `HIGHLIGHT` 是**一整套写死的暗色系色板**（`#5f8f3f` 绿、`#a15fb0` 紫、`#b57a2a` 棕…）。这在浅色主题下会整体偏暗、发闷——图 1 悬停卡里的 JSDoc 代码块就是这组色。

**改法（本期做最小闭环，不做过深的自动取色）**

1. 把 `HIGHLIGHT` 的每个色值换成 **`var(--iwb-syn-*)` 变量**。
   > **不能用 `prefers-color-scheme` 切换两套值**：宿主主题不是系统主题，`prefers-color-scheme` 在 DSH 里不可靠。取色**只能由宿主变量驱动**。

2. 在 `styles.js:11-38` 的变量块里定义 `--iwb-syn-comment` / `--iwb-syn-string` / `--iwb-syn-keyword` / `--iwb-syn-type` 等，值一律写成 `var(--dsw-alias-*, fallback)`。
   > 宿主若没有语法色别名（很可能没有），fallback 只能给一套——这一套 fallback 必须在**浅色底**上也读得清（选中间调，不要沿用现在这套暗色系的值）。

3. **取色策略（已定）**：**不追求逐 token 跟随宿主的语法色板，改为跟随宿主的「层」与「品牌色」**——注释用 `--iwb-muted`，字符串用 `--iwb-syn-string`，关键字用 `--iwb-accent`，类型用 `--iwb-syn-type`……其中**只有 3–4 支需要自选**，其余由品牌色/中性色派生。
   > 这条路的理由：**只维护 4 个变量而不是 10 个色值**，且天然同时在浅色与深色底上成立——不依赖宿主提供语法色别名（它大概率没有）。

**验收口径**

- 浅色主题下，编辑器正文语法高亮**每一种 token 都清晰可读**（人工在浅色底上逐类确认：注释、字符串、关键字、数字、类型、函数名）。
- 样式表里不再出现 `CodeEditor.jsx:126-140` 那一组原始 hex（可被自动化断言）。

### 1.5 THEME-04 — 索引决策弹窗的布局与话术精修

**现状**

- 结构（`Workbench.jsx:563-623`）：`h2` 标题 + 一段 `p` + 可选的根目录警告块 + 一排文字按钮。
- 样式：`styles.js:1192-1200`（`.iwb-index-decision` 只有 `max-width: 520px`）。
- 文案（`i18n.js:1017-1025` / 英文 `:500-508`）：

  | key | 现行文案 |
  |---|---|
  | `index.decision.title` | 为 {name} 构建代码索引？ |
  | `index.decision.body` | 首次构建可能需要 1–2 分钟，期间可以随时取消。不构建则只提供保守版（基础补全 + 文本查找引用）。 |
  | `index.decision.rootTitle` | 这是工作区根目录 |
  | `index.decision.rootWarning` | 工作区根目录通常包含多个独立仓库。在此索引会把它们当作同一个程序，显著增加内存占用与构建时间。建议先切换到具体子目录。 |
  | `index.decision.build` | 构建索引 |
  | `index.decision.buildRoot` | 在此目录索引（不推荐） |
  | `index.decision.conservative` | 仅保守版 |
  | `index.decision.cancel` | 取消 |

**三个实质问题**

1. **「构建代码索引」这个说法本身是错的。** PRD-v5 §0.2 #1 已经写明：不存在「可构建、可持久化的索引产物」，"构建索引" ≡ **启动语言服务器并等待它完成首次 program 构建**。但用户看到的文案还在说「构建代码索引」，这会让人以为会生成索引文件、会占磁盘。用户说「不太好看」时看到的就是这块。
2. **按钮的主次与文案相反。** `Workbench.jsx:600-619`：根目录时「在此目录索引（不推荐）」拿的是 `iwb-textbtn iwb-primary`，而「仅保守版」是普通文字按钮——**不推荐的选项被做成了主按钮**。
3. **非根目录时没有「不构建也不切换」的出口。** `isRoot` 为 false 时不渲染 `cancel` 按钮，用户只能选「构建索引」或「仅保守版」，后者**同样会切换项目**（`store.js:1013-1019`：`choice !== 'cancel'` 就切换）。于是「取消」=「切换但不建索引」，与按钮字面意思相反。

**改法**

1. **话术**改成讲清代价与收益：

   | key | 新文案（zh-CN） |
   |---|---|
   | `index.decision.title` | 为 {name} 启用语义分析 |
   | `index.decision.body` | 将启动 {language} 语言服务器并建立项目索引，预计首次构建约 {time}，占用内存约 {memory}。建立后可用语义补全、跳转定义与查找引用；不建立则只保留基础补全与文本查找。 |
   | `index.decision.rootTitle` | 这是工作区根目录 |
   | `index.decision.rootWarning` | 工作区根目录通常包含多个独立仓库。语言服务器会把它们当作同一个程序处理，内存占用与构建时间都会明显增加。建议先切换到具体子目录再启用。 |
   | `index.decision.build` | 启用（预计 {time}） |
   | `index.decision.buildRoot` | 仍在此目录启用 |
   | `index.decision.conservative` | 不启用，仅基础功能 |
   | `index.decision.cancel` | 取消切换 |

   > `{time}` / `{memory}` 由 MEM-01 的估算模型给出；`{language}` 取当前语言。

2. **按钮主次**：
   - 根目录：「仍在此目录启用」用**普通**按钮（去掉 `iwb-primary`），「不启用，仅基础功能」用**普通**按钮，「取消切换」用**普通**按钮——三者同级，因为这个场景下**没有推荐的选项**。
   - 非根目录：「启用（预计 {time}）」用 `iwb-primary`，「不启用，仅基础功能」用普通按钮，**并补一个「取消切换」**（`isRoot ? ... : ...` 的条件反过来，见下）。

3. **补上非根目录的「取消切换」出口**：`store.js:1013-1019` 的 `#switchProjectWithIndex` 已经支持 `'cancel'`（`#decideIndex` 的返回值域含 `'cancel'`），只是 UI 没有把它接出来。改动很小，且消除了「用户以为取消了但项目还是切了」的陷阱。

4. **布局精修**（`styles.js:1192-1200`）：
   - 加一个**标题栏**（`.iwb-modal-head` 已在 `styles.js:780-788` 定义，含标题与右侧关闭位）——当前索引弹窗是裸 `h2`，与其他弹窗形态不一致。
   - 警告块改成**左侧竖条 + 图标**的样式（现在是整块 `background` 底色，见 `styles.js:1193-1197`），并把 `var(--iwb-warn)` 用作竖条颜色（现在 `styles.js:1199` 已经这么用了，保持）。
   - 按钮行右对齐，与 `.iwb-modal-actions`（`styles.js:788`）对齐；破坏性/非推荐项不要用主色实心。
   - 弹窗宽度 `min(520px, calc(100% - 40px))` 已经是 `.iwb-modal` 的默认（`styles.js:769`），`max-width: 520px` 可以去掉。

**验收口径**

- 浅色与深色主题下，弹窗底色/边框/文字均取自 `--dsw-alias-*`，无硬编码色。
- 根目录场景下，三个按钮**视觉权重相同**；非根目录场景下，「启用」是唯一的主按钮，且存在「取消切换」——点了之后项目**不切换**。
- 弹窗文案里不出现「构建代码索引」字样（改为「启用语义分析 / 建立项目索引」）。

---

## 2. MEM —— 内存策略、降级可见性与恢复

### 2.1 事实核实

**（a）2GB 是怎么变成硬门槛的**

`src/host/lsp.js:1047-1058`：

```js
#resourcesSnapshot(memoryLimitMB, freeMemoryThresholdMB) {
  const memory = this.#readMemory()
  const needBytes = Math.max(0, memoryLimitMB) * 1024 * 1024
  const thresholdBytes = Math.max(needBytes, Math.max(0, freeMemoryThresholdMB) * 1024 * 1024)
  return {
    totalBytes: memory.totalBytes,
    freeBytes: memory.freeBytes,
    thresholdBytes,
    memoryLimitMB,
    canIndex: memory.freeBytes >= thresholdBytes,   // ← 一刀切
  }
}
```

默认值（`host/lsp.js:104-115`）：

```js
memoryLimitMB: 2048,
freeMemoryThresholdMB: 2048,
```

**问题在这里**：`thresholdBytes = max(memoryLimitMB, freeMemoryThresholdMB)`。这个 `max` 让**下限永远不低于上限**，于是：

- `memoryLimitMB` 本来的语义是「**允许这个语言服务器用到多少**」（上限），却被当成了「**至少要有多少空闲内存**」（下限）。
- YAML 服务器的 `memoryLimitMB` 是 **512**（`host/lsp.js:72`），但因为 `freeMemoryThresholdMB` 默认 2048，**它同样要求 2GB 空闲内存才能启动**。
- 用户说的「本身 200MB 就足以维持功能正常运转」——在当前实现下**无法表达**。

**（b）门槛在哪里生效**

| 位置 | 时机 | 行为 |
|---|---|---|
| `host/lsp.js:1175-1179` | 每次 `start` 之前 | `canIndex === false` → 直接 `degraded`，**不启动、不询问用户** |
| `host/lsp.js:1805-1809` | 崩溃后尝试重启之前 | 同上 → `degraded` |
| `host/lsp.js:1826-1830` | `#restart` 之前 | 同上 → `degraded` |
| `src/client/store.js:1043-1049` | 切项目时的预检 | `canIndex === false` → 弹一个 **toast**（`lsp.lowMemory`）并 `return 'conservative'`，**没有让用户选择的余地** |

→ 用户描述的「只要剩余可用内存低于 2GB，代码索引就直接不可用」**完全属实**。

**（c）为什么「悄无声息地降级」**

1. **状态栏读的是宿主会话状态，与请求失败没有回写通道。**
   `Workbench.jsx:281-345` 的 `lspStatusView` 只读 `state.lsp.state`；`case 'ready'` → `t('lsp.status.ready')`（「语义分析：就绪」），`tone: 'ok'`。
2. **请求超时只弹 toast，不改状态。**
   `src/client/lsp-session.js:75-93` 的 `redirectErrorsToToast` 把库里的 `LSPPlugin.reportError` 劫持成 `store.toast('error', ...)`，**没有回写任何状态**。
3. **宿主状态机也不会因为单次请求超时而降级。**
   `host/lsp.js:141-144` 的状态机里，`ready` 只会因为进程崩溃 / 取消 / 空闲退出而离开 `ready`；一次 `textDocument/references` 超时**不会**让它变成 `degraded`。

→ 于是出现用户描述的错位：**功能已经不可用（`Request timed out`），状态栏还说「就绪」**。

**（d）降级之后没有恢复入口**

- 状态栏项的 `action` 只有两种（`Workbench.jsx:366-368`）：`'settings'`（跳设置页）和 `'crash'`（再弹一次崩溃提示）。**没有「重新建立索引」**。
- 客户端**从不**调用 `lsp.shutdown`（`src/index.js:512` 有这个路由）与恢复类接口；`lsp.start` 只在切项目时被调用（`store.js:1136-1141`）。
- 所以用户说的「只能通过切换 Project 再切回来让代码索引重新生效」是当前实现的**唯一路径**。

**（e）顺带核实：关闭开关后进程不会立刻退出**

- `src/client/lsp-session.js:355-381` 的 `refreshLsp()`：`lspSettings?.enabled === false` → `stopLsp()` → 关闭 WebSocket、销毁 client。
- `src/host/lsp-ws.js:112-115`：WebSocket `close` 事件只做 `detach()`（摘掉 sink），**不停语言服务器进程**。
- 宿主侧的语言服务器会一直活到 `idleTimeoutMs`（默认 **10 分钟**，`host/lsp.js:110`）才被空闲退出。
- → 用户关掉「启用语义分析」后，**内存没有立刻回落**，而这恰恰是用户最想省内存的场景。

### 2.2 MEM-01 — 内存门槛从「一刀切」改为按语言估算

**改法**

1. **拆分两个语义的字段**（`host/lsp.js:104-115` 的 `DEFAULT_LSP_SETTINGS`）：

   | 字段 | 现语义 | 新语义 |
   |---|---|---|
   | `memoryLimitMB` | 上限，**同时**被当成下限 | 只做**上限**：语言服务器最多能用多少内存（继续注入 `maxTsServerMemory`） |
   | `freeMemoryThresholdMB` | 硬门槛 | 降级为**兜底下限**（默认从 2048 降到 **512**），只在估算值缺失时使用 |
   | `memoryBaselineMB`（新增，可按语言覆盖） | — | **估算基线**：该语言服务器启动后的典型占用 |

2. **新增注册表字段**（`host/lsp.js:49-102` 的 `LSP_REGISTRY` 每个条目）：

   ```js
   typescript: { …, memoryLimitMB: 2048, memoryBaselineMB: 256 },
   javascript: { …, memoryLimitMB: 2048, memoryBaselineMB: 256 },   // 同一个 tsserver
   python:     { …, memoryLimitMB: 1536, memoryBaselineMB: 192 },
   yaml:       { …, memoryLimitMB: 512,  memoryBaselineMB: 64 },
   java:       { …, memoryLimitMB: 2048, memoryBaselineMB: 512 },
   go:         { …, memoryLimitMB: 1536, memoryBaselineMB: 256 },
   rust:       { …, memoryLimitMB: 2048, memoryBaselineMB: 512 },
   cpp:        { …, memoryLimitMB: 2048, memoryBaselineMB: 384 },
   ```

   > 基线取「典型值」而非「最坏值」：tsserver 空载约 120–180 MB，加载一个中型 TS 项目后约 300–600 MB。基线按「空载 + 小项目」取值，再乘余量，覆盖大多数场景；大项目不够时用户可以调高 `memoryLimitMB`。
   > `memoryBaselineMB` 允许在 `settings.lsp.servers[lang].memoryBaselineMB` 覆盖（与 `memoryLimitMB` 同一套覆盖机制，`host/lsp.js:715-717`）。

3. **新的判定**（替换 `#resourcesSnapshot` 的 `canIndex`）：

   ```js
   const baselineMB = override.baselineMB ?? registryEntry.memoryBaselineMB ?? DEFAULT_BASELINE_MB
   const needMB     = Math.min(baselineMB, memoryLimitMB) * MEMORY_HEADROOM   // MEMORY_HEADROOM = 1.5
   const hardFloorMB = 256
   const thresholdBytes = Math.max(hardFloorMB, needMB) * 1024 * 1024
   canIndex = freeBytes >= thresholdBytes
   ```

   - YAML：基线 64 MB × 1.5 = 96 MB → **可用内存 300 MB 就能启动**（正是用户想要的）。
   - TypeScript：基线 256 MB × 1.5 = 384 MB → 空闲 384 MB 即可启动（远好于 2 GB）。
   - 硬下限 256 MB：低于此值任何语言都不启动（物理上必然失败）。

4. **对外暴露估算值**：`host/lsp.js:735-742` 的 `resources()` 已经在返回 `thresholdBytes` / `canIndex`，**新增** `needMB`、`baselineMB`、`headroom`、`hardFloorMB` 四个字段，供客户端展示与设置页说明使用。

5. **预估随仓库规模微调（可选，本期可后置）**：按 `host/workspace.js` 的文件清单估算（`files × 平均文件大小`）。本期**不做**——先让阈值从 2 GB 降到几百 MB 级，用户能跑起来比精确更重要。

**验收口径**

- 在可用内存 **300 MB** 的机器上打开一个 YAML 项目：语言服务器**能启动**（`lsp.resources.canIndex === true`），不再因为 2 GB 门槛降级。
- 在可用内存 **300 MB** 的机器上打开一个 TypeScript 项目：能启动（阈值 384 MB 时应给出**软提醒**而非直接拒绝，见 MEM-02）。
- `lsp.resources` 返回的 `needMB` 与 `thresholdBytes / 1MB` 一致。
- 回归：可用内存 **< 256 MB** 时仍然拒绝启动。

### 2.3 MEM-02 — 内存不足时先提醒、让用户决定

**改法**

把现在的「直接 `degraded`」改成**三段式**：

| 区间 | 判定 | 行为 |
|---|---|---|
| `freeBytes >= needBytes * SOFT_FACTOR` | 充足 | 直接启动 |
| `hardFloorMB <= freeBytes < needBytes * SOFT_FACTOR` | **紧张** | **弹窗**：「当前可用内存 {free} MB，{language} 预计需要 {need} MB。仍然启动 / 降级为保守版」 |
| `freeBytes < hardFloorMB` | 不足 | 直接降级 + toast（保留现有行为，但文案更新） |

- `SOFT_FACTOR` 默认 **2.0**（即：估算值的 2 倍以内视为紧张）。
- 弹窗复用 `IndexDecisionModal` 的形态（`Workbench.jsx:563-623`），新增一组文案：
  - `lsp.memoryWarn.title`：内存紧张
  - `lsp.memoryWarn.body`：可用内存 {free} MB，{language} 预计需要 {need} MB。
  - `lsp.memoryWarn.start`：仍然启动
  - `lsp.memoryWarn.conservative`：降级为保守版
- **决策通道**：宿主 `lsp.start` 增加一个 `force` 参数（`src/index.js:499-502` 目前只透传 `root` / `languageId`）。
  - `force === true` → 跳过内存预检启动（用户已明确选择）。
  - 记住本次选择：`settings.lsp.memoryWarnedRoots` 记录已提醒过的 root，**同一项目不再反复问**（换项目重新评估）。
- 客户端侧：`store.js:1043-1049` 的切项目预检同步改成三段式——「紧张」时也走弹窗，而不是现在的 toast。

**验收口径**

- 可用内存落在「紧张」区间时切项目：出现内存提醒弹窗，两个出口都在；选「仍然启动」→ 语言服务器起来了；选「降级为保守版」→ 不启动，状态栏显示保守版。
- 同一项目再次切换：**不再重复弹**内存提醒。
- 可用内存低于硬下限时：仍然直接降级（不弹窗），toast 文案包含「需要 {need} MB / 可用 {free} MB」。

### 2.4 MEM-03 — 降级状态必须可见（修「静默失效」）

这是本轮**最影响可用性**的一条：用户说「这个降级非常频发，基本上开一会儿，就悄无声息降级了，这直接使得这个智能代码的功能形同虚设」。

**改法**

1. **客户端新增健康度状态**：在 `state.lsp` 上加两个字段（`src/client/store.js` 的 lsp 切片）：

   | 字段 | 含义 |
   |---|---|
   | `consecutiveFailures` | 连续失败的语义请求数（成功一次即归零） |
   | `lastFailure` | `{ message, at }`，最近一次失败 |

2. **计数点**：在 `src/client/lsp-session.js:79-92` 的 `reportError` 劫持里累加。
   - **只统计语义请求失败**：`LSPPlugin.reportError` 会收到 `Finding references failed` / `Find definition failed` / 补全失败等消息；**需要排除与语义无关的错误**（例如文档同步失败），否则计数会被污染。
   - 成功路径：在 `lsp-session.js` 里补一个「语义请求成功」的回调，把计数归零。最省事的做法是包一层 `client.request`，成功时归零。

3. **状态栏合成两个来源**（`Workbench.jsx:281-345`）：

   ```
   宿主状态（state.lsp.state）  ×  客户端健康度（state.lsp.consecutiveFailures）
   ```

   | 组合 | 文案 | tone |
   |---|---|---|
   | `ready` + 0 失败 | 语义分析：就绪 | `ok`（保持现状） |
   | `ready` + ≥3 失败（或连续 ≥2 次超时） | **语义分析：不稳定（连续失败 N 次）** | **`warn`**（现在是 `ok`——这就是「静默失效」） |
   | `ready` + 失败但 < 3 | 语义分析：就绪 | `ok`（短暂抖动不打扰） |
   | `degraded` | 语义分析：保守版 | `warn`（现在是 `idle`——保守版不等于正常） |
   | `crashed` | 语义分析：已崩溃 | `error`（现状） |

   > `degraded` 从 `idle` 改成 `warn` 很重要：现在降级了和正常态在视觉上几乎一样（都是灰色圆点），用户看不出来。

4. **状态栏点击展开诊断面板**（`Workbench.jsx:366-368` 现在只有 `settings` / `crash` 两个动作）：

   新增 `action: 'diagnostics'`，点击状态栏项弹一个小面板（复用 `.iwb-modal-backdrop` + `.iwb-modal`，`styles.js:765-771`）：

   | 行 | 内容 |
   |---|---|
   | 当前状态 | 宿主状态 + 客户端健康度 |
   | 最近失败 | `lastFailure.message` 与时间 |
   | 语言服务器 stderr | 走 `lsp.logs`（`src/index.js:517-519`）取最后若干行 |
   | 内存 | 当前可用 / 估算需求 |
   | 操作 1 | **重新建立索引**（→ MEM-04） |
   | 操作 2 | 降级为保守版（关闭当前语言服务器） |
   | 操作 3 | 打开设置（跳到「语义分析」组） |

**验收口径**

- 制造连续 3 次语义请求失败（可用 mock 语言服务器或直接调 `reportError`）：状态栏文案从「就绪」变成「不稳定」，且 `tone` 从 `ok` 变 `warn`（视觉上必须有区别）。
- 任一次语义请求成功 → 计数归零，文案回到「就绪」。
- 宿主状态为 `degraded` 时，状态栏**不是** `idle` 灰点，而是 `warn` 色。
- 点状态栏 → 诊断面板打开，能看到最近一次错误与语言服务器 stderr。

### 2.5 MEM-04 — 降级后必须能重新建立索引

**改法**

1. **宿主已有能力**：`lsp.start`（`src/index.js:499-502`）可以重新启动语言服务器；`lsp.shutdown`（`src/index.js:512-514`）可以停掉它。**客户端一条都没用**（`store.js` 只调 `lsp.status` / `lsp.index` / `lsp.start` / `lsp.cancelIndex` / `lsp.servers` / `lsp.resources`）。
2. **新增 store 方法**（`src/client/store.js`）：

   ```js
   async restartLsp() {
     await call('lsp.shutdown', { root: this.state.root })
     await call('lsp.start',  { root: this.state.root })
     await this.refreshLspStatus()
   }
   ```

   `lsp.shutdown` 必须在 `lsp.start` 之前调用——否则旧会话还在，新会话拿不到内存。
3. **入口**：
   - 状态栏诊断面板（MEM-03）的「重新建立索引」按钮；
   - **保守版状态下直接显示一个恢复按钮**（`Workbench.jsx:354-392` 的 `LspStatus` 现在只在 `cancellable` 时显示「取消索引」按钮，加一个 `action` 位的「重新建立索引」按钮）；
   - `degraded` / `cancelled` / `idle` 状态下，状态栏项**可点击**（现在只有 `crash` 态可点）。
4. **重新建立时的等待**：重启要走完「启动 → building → ready」，期间状态栏显示「正在重建索引…」，`Workbench.jsx` 的 2 秒轮询（`store.js:1431-1480`）会自动跟上。

**验收口径**

- 把语言服务器进程 kill 掉并让宿主进入 `degraded`：点状态栏 → 「重新建立索引」→ ≤ 30 秒内回到「就绪」，**不需要切换项目**。
- 内存紧张降级后，用户释放内存 → 点「重新建立索引」→ 成功恢复。

---

## 3. USAGE —— 查找用法（语义）修复

### 3.1 事实核实（根因已定位）

**现象**：语义版「查找用法」基本都不可用。

**根因**：工作台自定义的 LSP workspace **没有覆写 `requestFile`**。

- 库基类 `Workspace.requestFile`（`node_modules/@codemirror/lsp-client/dist/index.js:200-202`）：

  ```js
  requestFile(uri) {
    return Promise.resolve(this.getFile(uri));   // 只认「当前已在编辑器里打开的文件」
  }
  ```

- 库的发引用逻辑（`:1600-1622`）：

  ```js
  getReferences(plugin, pos).then(response => {
    if (!response) return
    return Promise.all(response.map(loc =>
      plugin.client.workspace.requestFile(loc.uri).then(file =>
        file ? { file, range: loc.range } : null)     // ← 拿不到文件就丢弃这条引用
      )
    )).then(resolved => {
      let locs = resolved.filter(l => l)               // ← null 全被过滤掉
      if (locs.length) displayReferences(plugin.view, locs, mapping)
    })
  })
  ```

- 本插件的 `WorkbenchWorkspace`（`src/client/lsp-workspace.js:196-434`）覆写了 `tabFor` / `contentOf` / `viewOf` / `openFile` / `syncFiles` / `insideRoot` / `notifyOutside` / `displayFile` / `connected` / `updateFile` / `closeFile`——**唯独没有 `requestFile`**。

→ **凡是当前没在编辑器里打开的文件，它的引用都被静默丢弃**。而「查找用法」的结果天然分布在别的文件里，所以面板几乎总是空的，或者只列出当前文件内的引用。这就是「基本都不可用」。

**排除的其他可能**（避免修错方向）：

| 怀疑 | 核实结论 |
|---|---|
| 服务器不支持 `references` | ❌ 排除。`docs/PRD-v5-实施进展.md` §5.2 的真机验证记录了 `referencesProvider` 在 23 项能力里 |
| 菜单项被置灰 | ❌ 排除。`CodeEditor.jsx:765` 的 `semanticUsagesAvailable()` 只看 `serverCapabilities.referencesProvider` 与 `state.lsp.state === 'ready'`，正常时是**可点**的 |
| 请求超时 | ⚠️ 可能叠加，但不是主因。主因是「拿到了响应，但条目被过滤光」 |
| 面板没渲染 | ❌ 排除。`styles.js:1144-1159` 有完整的 `.cm-lsp-reference-panel` 样式 |

### 3.2 USAGE-01 — 覆写 `requestFile`

**改法**

在 `src/client/lsp-workspace.js` 的 `WorkbenchWorkspace` 里加一个 `requestFile(uri)`：

```js
/**
 * The file of one URI, whether or not it is open in an editor.
 *
 * The library's default implementation only knows the files that have an
 * editor, and `findReferences` drops every reference whose file is not in
 * that list. A "find usages" therefore returned almost nothing, because the
 * usages are usually in other files.
 *
 * @param {string} uri the document URI
 * @returns {Promise<any>} the file, or `null` when it cannot be read
 */
async requestFile(uri) {
  const existing = this.getFile(uri)
  if (existing !== null && existing !== undefined) return existing
  const absolute = pathOfFileUri(uri)
  if (absolute === null) return null
  if (!this.insideRoot(absolute)) return null          // 围栏：项目外不读
  const content = await this.readFileContent(absolute)  // 只读磁盘，不开标签页
  if (content === null) return null
  return {
    uri,
    languageId: languageIdOf(absolute),
    version: 1,
    doc: textOf(content),
    getView() { return null },
  }
}
```

要点：

1. **不打开标签页**——`requestFile` 的用途只是拿到文档内容以便渲染引用行的上下文；打开标签页会把「查找用法」变成一次批量开文件。
2. **尊重围栏**——项目外的路径返回 `null`（与 `displayFile` 的 `notifyOutside` 一致，但这里**不弹 toast**，否则一次查找可能弹几十个 toast）。
3. **需要一个新的宿主 API 读文件**：客户端目前只有 `fs.read`（`src/index.js` 的 `fs.read`），但它要求文件在 workspace 根内、且返回 `kind: 'text' | 'binary'`。加一个只读的 `fs.readText` 或复用 `fs.read` 均可；**必须复用宿主已有的路径围栏**（`src/host/workspace.js` 的 `resolveInside`），不要在客户端自己拼路径。
4. **性能**：`findReferences` 会对**每一条**引用调用一次 `requestFile`。若一次查找有 200 条引用分布在 50 个文件里，就是 50 次读盘。→ **必须加缓存**：按 `uri` 缓存本次查找周期内的内容；建议加一个简单的 `Map` + 容量上限（如 64 个文件），查找结束即清空。

**验收口径**

- 在一个 TS 项目里对 `spawn` 执行「查找用法（语义）」：引用面板列出**跨文件**的全部命中（至少包含当前未在编辑器打开的文件）。
- 点引用面板里的一条 → 打开对应文件并定位到行/列。
- 项目外的路径不出现在面板里，且**不弹 toast**。
- 200 条引用分布在 50 个文件：查找耗时 < 3 s（缓存生效的判据）。

---

## 4. SET —— 智能代码相关设置

### 4.1 事实核实

**设置页已经有【语义分析】组**（`src/client/SettingsPanel.jsx:382-462`），条目：

| i18n key | 字段 | 控件 | 默认 |
|---|---|---|---|
| `settings.lspEnabled` | `lsp.enabled` | 复选框 | `true` |
| `settings.lspIndexOnOpen` | `lsp.indexOnOpen` | 下拉（ask/always/never） | `'ask'` |
| `settings.lspMemoryLimit` | `lsp.memoryLimitMB` | 数字 | 2048 |
| `settings.lspFreeMemory` | `lsp.freeMemoryThresholdMB` | 数字 | 2048 |
| `settings.lspIdleTimeout` | `lsp.idleTimeoutMs` | 数字（分钟） | 600000 |
| `settings.lspRequestTimeout` | `lsp.requestTimeoutMs` | 数字 | 30000 |
| `settings.lspAutoExit` | `lsp.autoExit` | 复选框 | `true` |
| `settings.lspAutoRestart` | `lsp.autoRestart` | 复选框 | `true` |

**用户要的「构建索引」开关已经存在**，而且行为正确：

- `lsp.enabled === false` → `src/client/store.js:1038` 的 `#decideIndex` 直接 `return 'conservative'`，**切换项目时不再询问** ✓
- `lsp.enabled === false` → `src/client/lsp-session.js:366-380` 的 `refreshLsp()` → `wanted = false` → `stopLsp()`，**不再创建 client、不再连接 WS** ✓
- `Workbench.jsx:289-291`：状态栏显示「语义分析：已关闭」 ✓
- 默认开启 ✓（`DEFAULT_LSP_SETTINGS.enabled = true`，`host/lsp.js:106`）

**所以这条不是「缺一个开关」，而是三个具体问题**：

1. **用户找不到 / 不确定它管不管用**：标签叫「启用语义分析」，用户的心智模型是「构建代码索引」。语义上确实是同一个开关，但命名不匹配。
2. **关了之后进程不退出**（§2.1(e)）→ 用户以为关了没用。
3. **没有按语言的粒度**：`settings.lsp.servers[lang].enabled` **有文档无实现**（代码检视报告 N7，`docs/PRD-v5-代码检视报告.md:229`）。`host/lsp.js:1107` 确实读了 `override.enabled === false` 并转 `degraded`，但设置页**没有**这个控件。

### 4.2 SET-01 — 索引总开关：语义收敛 + 关闭即退进程

**改法**

1. **不改字段名**，只改文案与说明（避免 schema 再升一版、避免已有配置文件失效）：

   | key | 新文案 |
   |---|---|
   | `settings.lspEnabled` | **构建代码索引** |
   | `settings.lspEnabledHint` | 关闭后不启动任何语言服务器，悬浮提示、语义补全与跳转定义都不可用；切换项目时也不再询问。关闭会立即结束正在运行的索引进程并释放内存。 |

   > 注意区分两个既有开关：`lsp.enabled`（总开关）与 `lsp.indexOnOpen`（切项目时的询问策略，`'ask' | 'always' | 'never'`）。用户描述的「切换 Project 时也不再询问」其实是 `indexOnOpen = 'never'` 的能力，但 `enabled = false` 也能达到（不再有可问的东西）。**两个都要保留**：`indexOnOpen = 'never'` = 每次都问都不问，但索引照建；`enabled = false` = 根本不建。

2. **关闭时立即停进程**（`src/client/store.js` 或 `lsp-session.js`）：

   ```js
   // lsp.enabled 从 true 变 false 时
   await call('lsp.shutdown', { root: this.state.root })
   ```

   触发点：`refreshLsp()` 里 `wanted === false && hadClient` 的分支（`lsp-session.js:378-380`）——但 `stopLsp()` 是同步函数，不能 await。**做法**：在 `refreshLsp()` 的 `else if (hadClient)` 分支里 fire-and-forget 调 `call('lsp.shutdown', { root })`，并把 `stopLsp()` 放在其后。

   > 顺序很重要：**先 shutdown 再断 WS**。反过来的话 `detach()` 会先执行，虽然 `shutdown` 仍然有效（它按 root 找会话），但日志顺序会让人误判。

3. **设置页补一条状态提示**：关闭时在组底部显示一行「当前有 N 个语言服务器进程在运行，关闭开关会立即结束它们」——如果 `lsp.servers` 里还有运行中的会话。

**验收口径**

- 勾掉「构建代码索引」→ 状态栏立刻显示「语义分析：已关闭」；**宿主侧语言服务器进程在 5 秒内退出**（`lsp.status` 返回 `idle`，进程树里没有该语言服务器）。
- 关闭状态下切换项目：**不弹**索引决策弹窗，项目正常切换。
- 重新勾上 → 切项目时**恢复询问**。

### 4.3 SET-02 — 补齐按语言启停（代码检视报告 N7）

**改法**

- 在【语义分析】组下新增一个「语言服务器」子列表：每个**已安装**的语言一行，带一个复选框。
- 数据来源：`lsp.servers` 路由（`src/index.js:506` → `host/lsp.js:709-728`）已经返回 `available` / `missing` / `disabled` 三个数组，`available[i]` 里有 `languageId` / `command` / `source` / `resolvedPath` / `memoryLimitMB`。
- 写入 `settings.lsp.servers[languageId].enabled`（**字段已经存在**，`host/lsp.js:715` 已在读）。
- 只读状态：`missing`（未安装，显示「未找到 <command>，请安装并加入 PATH」）与 `disabled`（已在设置里关掉）。

**验收口径**

- 在设置里关掉 `typescript` → 打开 TS 文件：状态栏显示该语言不可用，右键菜单里的「跳转定义 / 查找用法」置灰并有 tooltip 说明原因；`lsp.status` 返回 `degraded`，`detail` 含「已关闭」。
- 打开 `python` 不受影响。

### 4.4 SET-03 — 内存阈值参数改造

**改法**

1. `settings.lspFreeMemory` 的语义从「硬门槛」改为「**保守兜底下限**」，默认从 2048 降到 **512**。
2. `settings.lspMemoryLimit` 的 hint 补一句「这是语言服务器的内存**上限**，不是启动门槛」。
3. **新增**一行「内存余量系数」（`settings.lsp.memoryHeadroom`，默认 1.5），以及一行「内存硬下限」（`settings.lsp.memoryHardFloorMB`，默认 256）。
4. 设置页在【语义分析】组底部加一条**动态说明**：调用 `lsp.resources` 拿到当前可用内存与估算需求，显示成
   「当前可用内存 1.2 GB；TypeScript 预计需要 384 MB（可启动）／ 保守上限 512 MB」。
   > 这一条价值很高：把「内存」从一个抽象数字变成用户当场能判断的事实。

**验收口径**

- 把「保守兜底下限」改成 4096 MB：只要估算需求满足，仍可启动（证明它不再是硬门槛）。
- 设置页底部显示的可用内存与 `lsp.resources.freeBytes` 一致。

---

## 5. GIT —— 文件树 Git 着色

### 5.1 事实核实

**根因在宿主的状态采集，不在前端的聚合。**

`src/host/git.js:269`：

```js
const args = ['status', '--porcelain=v2', '--branch', '-z']
```

**没有 `--untracked-files=all`（`-uall`）**。git 默认的 `status.showUntrackedFiles=normal` 会把「整个未被跟踪的目录」折叠成**一条**记录 `? dir/`。解析处（`src/host/git.js:205-208`）原样收下，不做任何展开：

```js
if (record.startsWith('? ')) {
  result.entries.push({ path: record.slice(2), xy: '??', untracked: true, conflict: false })
}
```

前端聚合（`src/client/git-colors.js:86-109`）把这条记录**当成一个文件**塞进 `files` 表：

```js
files.set(entry.path, kind)                              // 'dir/' → files 表
for (const dir of ancestorsOf(entry.path)) { … }          // 'dir/' → ancestors ['dir'] → dirs 表
```

而文件树渲染时（`src/client/ProjectPanel.jsx:874-877`）**目录查 `dirs`、文件查 `files`**：

```js
const kind = row.kind === 'dir' ? status.dirs.get(statusKey) : status.files.get(statusKey)
```

→ 目录行拿到 `untracked`（着色 ✓），目录下的文件行在 `files` 表里查不到（**不着色 ✘**）。

**用户描述的第二个现象也解释得通**：目录里若有一个**被跟踪且已修改**的文件，git 在 normal 模式下会**单独**报出这个文件 → 只有它着色；其余未跟踪文件仍然不在列表里 → 「仅当其中至少一个文件有 Git 着色后，其他的文件才会着色」。

**Commit 面板的连带问题**：
- 变更列表来自 `state.status.entries`（`store.js:2820-2827` → `commit-model.js:23-34`），未跟踪目录也是**一行**。
- 双击该行 → `CommitPanel.jsx:153-156` 的 `openChange` → `store.openDiff({ path: 'dir/', untracked: true })` → `src/index.js:341-343` 的 `readFileForPreview` → `src/host/workspace.js:294` 抛 `ApiError('bad-request', 'path is a directory')` → **原始英文错误直达用户**（没有中文化、没有兜底）。
- i18n 里**没有**「这是目录」相关的文案（已全量检索 `commit.*` 与 `diff.*`）。

### 5.2 GIT-01 — 未跟踪文件以文件为粒度着色

**改法**

1. **`src/host/git.js:269`** 的参数加 `--untracked-files=all`：

   ```js
   const args = ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']
   ```

   - 同时用 `-c status.showUntrackedFiles=all` **强制覆盖用户全局配置**（`src/host/git.js:55-60` 已经在用 `-c` 覆盖 `core.quotepath` / `color.ui` / `advice.detachedHead`，加一条 `status.showUntrackedFiles=all` 与众一致），否则用户本机配了 `normal` / `no` 时行为不一致。
   - **代价**：`git status -uall` 会枚举未跟踪目录里的**每一个文件**。在一个有 10 万个未跟踪文件的仓库上会明显变慢。缓解：
     - 未跟踪目录通常被 `.gitignore` 覆盖（`node_modules/`、`dist/`），`-uall` **不会**列出被忽略的文件（除非加 `--ignored`），所以实际增量有限；
     - 状态轮询是 2 秒一次（`store.js:1578` 一带），需要观察一次真实仓库的耗时变化；
     - 若发现退化，改为**按需展开**：保持 `normal` 模式，遇到 `? dir/` 记录时，**只对展开的目录**追加一次 `-uall -- <dir>` 的子查询（`git status --porcelain=v2 -z -uall -- dir/`）。**这是二期方案，本期先上 `-uall` + 实测。**

2. **前端 `git-colors.js` 不用改**：`aggregateStatus` 的模型本来就是「文件是一等公民，目录由后代聚合」（`git-colors.js:10-12` 的注释就是这么写的）。`-uall` 之后 `files` 表里会有每个文件，目录色自动由 `ancestorsOf` 聚合而来——**目录色随目录下的文件**正是用户期望的语义。

3. **`files.set(entry.path, kind)` 要防目录路径**（防御性）：即便如此，仍可能有 `? dir/` 这类记录（极端情况、`.gitignore` 规则、或用户全局配置覆盖）。加一道判断：如果 `entry.path` 以 `/` 结尾（porcelain v2 的目录条目带尾斜杠），**不要**放进 `files` 表，只放进 `dirs` 表。

   ```js
   // git-colors.js aggregateStatus
   const isDirEntry = entry.path.endsWith('/')
   if (isDirEntry) {
     const dir = entry.path.replace(/\/+$/, '')
     dirs.set(dir, kind)
     for (const dir of ancestorsOf(dir)) { … }
     continue
   }
   files.set(entry.path, kind)
   ```

   → 这样即便上游仍返回目录条目，**目录下的文件也不会被错误地标成"目录本身"**，行为可预期。

**验收口径**

- 在一个含未跟踪目录（内有 3 个文件）的仓库里：**3 个文件各自着色**（untracked 红），目录本身也着色（由子文件聚合）。
- 一个未跟踪目录里有「1 个已修改的已跟踪文件 + 2 个未跟踪文件」：**3 个文件都着色**（分别是 modified / untracked / untracked）。
- 目录折叠时目录图标仍带聚合色。
- 性能：在一个 2 万文件的仓库上，`git status` 的耗时相对基线增量 < 300 ms。

### 5.3 GIT-02 — Commit 面板的目录条目可展开

**改法**

1. **`git status -uall` 之后，未跟踪目录自然消失**（它变成了一堆文件行）→ GIT-01 做完，本条的一大半自动消失。剩下的情况：
   - **被跟踪的空目录**（git 不跟踪空目录，所以不存在）；
   - **submodule 目录**：porcelain v2 会报一条 `? sub/`（submodule 未初始化）或 `1 .S...`；
   - 用户全局 `status.showUntrackedFiles=no`（被 `-c` 覆盖后不存在）。
2. **保留一道兜底**：`CommitPanel.jsx:153-156` 的 `openChange` 在 `entry.path` 以 `/` 结尾时，**不要**调 `openDiff`，改为**展开该目录**（把目录下的文件行显示出来），并给一个提示「这是一个目录，已展开」；若无法展开，给**中文**提示「该条目是目录，无法显示差异」。
3. **新增 i18n**：`commit.entryIsDirectory` = '该条目是目录，无法显示差异。'

**验收口径**

- 双击一个目录条目：不出现英文 `path is a directory`；要么展开成文件列表，要么给出中文提示。
- `i18n.js` 中 `commit.*` 不再出现任何未翻译的宿主错误直出。

---

## 6. FIND —— 全项目查找从标签页改为弹窗

### 6.1 事实核实

**现状：两个入口都是内容区的标签页。**

| 入口 | 位置 | 产生的 tab |
|---|---|---|
| 全项目查找（`Ctrl+Shift+R` / `Ctrl+Alt+F`） | `src/client/index.jsx:528-534` → `store.openSearchTab()`（`store.js:1882-1900`） | `id: 'search:in-files'`，`kind: 'search'` |
| 查找用法（文本版，`Alt+F8`） | `src/client/lsp-session.js:558-568` → `store.findUsagesText()`（`store.js:1911-1940`） | `id: 'search:usages'`，`kind: 'search'` |

- 两者**共用同一个 `state.search` 切片**（`store.js:172-189`），只用 `textMatch` 布尔量区分。
- `src/client/EditorArea.jsx:753-763`：`active.kind === 'search'` 时在内容区渲染 `SearchView`，**并把 `TabBar` 一起渲染在上面** → 搜索视图和文件标签页同层、同级。
- `src/client/EditorArea.jsx:215-242`：`TabBar` 统一遍历所有 tab，搜索 tab 的标题（`search.title` = '全项目查找' / `nav.usagesTitle` = '查找用法'）和文件 tab 一样，也带关闭按钮。
- `src/client/SearchView.jsx:114-201`：`.iwb-search` 是**填充式**视图（`styles.js:878`：`flex: 1; min-height: 0`），不是浮层。
- 跳转到文件后搜索 tab **仍然保留**（`store.js:1875-1879` 的 `openFile` 只是新开一个文件 tab）。

**语义版查找用法（`Alt+F7`）不走这条路**——它是 CodeMirror 的引用面板（`CodeEditor.jsx:802-813` → `lsp-client` 的 `findReferences`），在编辑器内部。用户在这一条里说的是**标签页形态的那两个**。

**已有的可复用件**

| 件 | 锚点 | 形态 |
|---|---|---|
| `QuickOpen` 整体 | `src/client/QuickOpen.jsx:61-103` | 顶部浮出的「弹窗 + 输入框 + 列表 + 计数」，键盘 `↑↓/Enter/Esc`，点遮罩关闭。**z-index 70**（`styles.js:910`） |
| `.iwb-modal-backdrop` + `.iwb-modal` | `styles.js:765-771` | 居中 modal，z-index 50 |
| `.iwb-menu` | `styles.js:461-466` | 视口锚定浮层菜单，z-index 40（**fixed**） |
| `ConfirmModal` / `Toast` | `src/client/ui.jsx:126-179` / `:182` | 通用弹窗与瞬态提示 |
| `store.runSearch(query, options)` | `store.js:1942-1974` | 已封装 token 竞态、错误、耗时、截断 |
| `store.openSearchResult(rel, line)` | `store.js:1875-1879` | 跳转入口（会新开一个文件 tab） |
| `store.openNextSearchResult(delta)` | `store.js:1862-1874` | `F8` 循环命中 |

**数据现状**：`src/host/search.js:103-115` 每条命中只有 `{ line, column, preview }`，`preview` 是**单行**（trim 后最长 240 字符，截断加 `…`）。**没有上下文行** → 预览区要显示上下文，必须扩数据结构。

### 6.2 FIND-01 — 查找结果改为弹窗

**改法**

1. **新建组件** `src/client/SearchPopup.jsx`，参照图 7（IDEA 的 Find in Files）的形态：

   ```
   ┌──────────────────────────────────────────────────────────┐
   │ [🔍] writeFileSync                          ✕            │  ← 搜索框（可继续编辑，重新搜）
   ├────────────────────────────┬─────────────────────────────┤
   │ 10 处引用 · 3 个文件        │  预览区                     │
   │ ▸ big-project.mjs  4       │  ┌───────────────────────┐  │
   │   11 import { writeFile…   │  │ 26  writeFileSync(join( │  │
   │   47 writeFileSync(join(   │  │ 27    PROJECT_DIR,     │  │
   │ ▸ gen-realistic.mjs 4      │  │ 28    'src', …)        │  │
   │   6  import { writeFile…   │  │ …                       │  │
   └────────────────────────────┴─────────────────────────────┘
   ```

   - **上半**：命中列表，按文件分组（沿用 `SearchView.jsx` 的分组结构）。
   - **下半**：预览区，显示选中命中所在行**及其前后若干行**。
   - **单击**列表项 → 下方预览该命中（**不跳转**）。
   - **双击**列表项 → 打开文件并定位到该行/列，**同时关闭弹窗**。
   - **关闭**：点遮罩 / 点右上角 ✕ / 双击命中后自动关闭。
   - 键盘：`↑↓` 移动、`Enter` 打开并关闭、`Esc` 关闭、`F8`/`Shift+F8` 在命中间循环。

2. **复用 `QuickOpen` 的骨架**：`.iwb-quick-backdrop`（z-index 70）+ `.iwb-quick` 面板 + `.iwb-quick-head` / `-list` / `-row` / `-name` / `-foot`。**新增** `-split`（上下分栏）、`-preview`（预览区）两组类。
   > 弹窗定位**顶部浮出式**（沿用 QuickOpen 的 `padding-top: 9vh`），比居中 modal 更接近 IDE 习惯，也避免遮挡状态栏；尺寸与分栏比例按 §0.4 #4：宽 `min(900px, 92vw)`、高 `min(640px, 80vh)`、列表 40% / 预览 60%。

3. **不再占用内容区标签页**：
   - `store.js:1882-1900` 的 `openSearchTab()` 改为 `openSearchPopup()`：**不**往 `state.tabs` 里加 tab，而是设一个 `state.searchPopup = { open: true }`。
   - `store.js:1911-1940` 的 `findUsagesText()` 同样改为打开弹窗。
   - `EditorArea.jsx:753-763` 的 `kind === 'search'` 分支**保留**（兼容旧状态与已打开的窗口），但不再是主要入口。

4. **两个入口的数据隔离**：现在 `state.search` 是**单一**切片，两个 tab 共享（`store.js:172-189`），切 tab 时 `key={active.id}` 只是重新挂载组件，数据仍然同源 → 两个查询互相覆盖。改成弹窗后，**同一个弹窗实例**复用同一份数据即可，但 `textMatch` 必须区分标题（`全项目查找` vs `查找用法`）。

**验收口径**

- `Ctrl+Shift+R` → 弹出弹窗，**代码标签页区不新增标签**。
- 弹窗内单击命中 → 下方预览该命中的上下文，不跳转。
- 双击命中 → 打开对应文件、定位到行与列、**弹窗关闭**。
- 点遮罩 / 点 ✕ → 弹窗关闭，当前浏览的代码标签页仍在且内容不变。
- 查找用法（文本版）同样走弹窗。

### 6.3 FIND-02 — 预览需要上下文行

**改法**

1. **扩结果结构**（`src/host/search.js`）：每条命中增加上下文字段。

   ```js
   entry.matches.push({ line, column, preview, before: [...], after: [...] })
   ```

   - `before` / `after`：各最多 **5 行**的文本数组；命中行在中间高亮。
   - 命中总数上限不变（`MAX_RESULTS = 2000`，`host/search.js:30`），但**上下文字段的总量要有上限**（例如每文件命中超过 200 条时——`host/search.js:114` 已经这么限了——只给前若干条命中带上下文，其余只带 `preview`）。否则结果 JSON 会暴涨。
   - 预算：200 条命中 × 11 行 × 平均 60 字符 ≈ 130 KB，可接受；超限时按上面的规则裁剪。

2. **预览渲染**：命中行高亮（用 `--iwb-accent` 的低透明底），上下行用 `--iwb-muted`；等宽字体；超长行横向滚动。
3. **二进制 / 超大文件**：不提供预览，显示「该文件是二进制文件，无法预览」。

**验收口径**

- 预览区显示命中行及上下各 5 行，命中行有高亮。
- 一个命中 5000 条的结果集，宿主返回的 JSON 不超过 **2 MB**（超限时按规则裁剪上下文）。
- 二进制文件命中：预览区显示明确提示，不空白。

---

## 7. PUSH —— Commit 手动推送

### 7.1 事实核实

**能力三层都有，只有 UI 缺一块。**

| 层 | 位置 | 状态 |
|---|---|---|
| 宿主 | `src/host/git.js:401-405` `push(env)` → `git push`（`REMOTE_TIMEOUT_MS = 180_000`） | ✅ 有 |
| 路由 | `src/index.js:411-414` `'git.push'` | ✅ 有 |
| store | `src/client/store.js:3177-3186` `async push(options)` → 成功/失败 toast + `refreshStatus` | ✅ 有 |
| **UI 按钮** | `src/client/CommitPanel.jsx:288-299` 只有「提交」与「提交并推送」 | ❌ **无** |

- `store.push` 在全仓的**唯一** UI 调用点是快捷键 `Ctrl+Shift+K`（`src/client/index.jsx:566`、`:574-580`；默认键位 `src/host/settings-store.js:141`）。
- 顶栏**有**「已提交未推送」的计数徽标：`Workbench.jsx:84-86` 的 `↑{ahead}`（`:87-89` 的 `↓{behind}`），数据来自 `git status --porcelain=v2 --branch` 的 `# branch.ab` 行（`src/host/git.js:172-179`）。**但徽标不可点**。
- 也没有 `pull` / `fetch`（宿主与路由都没有）。

→ 用户说「提交了之后，那些落后于 origin 的提交，就没有一个地方可以 push，只能通过 terminal 来 Git push」——**完全属实**（只能靠快捷键，而快捷键在设置里藏得很深）。

### 7.2 PUSH-01 — Commit 面板补独立「推送」按钮

**改法**

1. `src/client/CommitPanel.jsx:288-299` 的按钮行增加第三个按钮：

   ```jsx
   React.createElement('button', {
     type: 'button',
     className: 'iwb-textbtn iwb-small',
     disabled: !canCommit || (slice.ahead ?? 0) === 0,
     title: t('commit.pushHint'),
     onClick: () => { void store.push() },
   }, t('commit.push'))
   ```

   - **没有待推送的提交时禁用**（`ahead === 0`），并把原因写进 `title`。
   - `ahead` 从哪来？`state.status.ahead`（`Workbench.jsx:84` 已经在用），Commit 面板的 slice 需要带上它。

2. **文案**：
   - `commit.push` = '推送' / 'Push'
   - `commit.pushHint` = '把本分支领先的提交推送到上游' / 'Push the commits this branch is ahead of to its upstream'
   - `commit.pushNoUpstream` = '当前分支没有上游，请先设置' / 'This branch has no upstream yet'

3. **无上游分支的处理**：`git push` 在无上游时会失败并提示 `set-upstream`。`store.push()`（`store.js:3177-3186`）会把错误原文弹成 toast。→ 改成**友好文案**：捕获 stderr 里含 `has no upstream branch` 时，提示「当前分支还没有上游，需要先设置上游分支」，并给出 `git push --set-upstream origin <branch>` 的建议（可一键复制）。

4. **推送中 / 成功 / 失败的反馈**：`store.push()` 已有 success / error toast（`commit.pushed` / `commit.pushFailed`）。补一个**进行中**的状态（按钮显示 `commit.pushing`），因为 push 可能要几十秒。

**验收口径**

- 提交一次改动后（不推送）→ Commit 面板出现「推送」按钮，**可点**；点击后提交被推上去了，`↑N` 徽标消失。
- 没有待推送提交时按钮**禁用**，`title` 说明原因。
- 无上游分支时点击 → 给出中文提示 + 可复制的命令，而不是一坨英文 stderr。
- 推送失败（断网）→ toast 说明失败，且**不丢**本地提交。

### 7.3 PUSH-02 — `↑N` 徽标可点并带状态说明

**改法**

- `Workbench.jsx:84-86` 的 `↑N` 徽标改成**可点**的按钮，点击弹一个小菜单（复用 `.iwb-menu` / `ContextMenu`，`src/client/ui.jsx:16`）：
  - 「领先 N 个提交 · 上游 {upstream}」
  - 「推送」（→ `store.push()`）
  - 「查看提交历史」（→ 打开 Git 面板）
- `↓N`（落后）徽标点击 → 提示「本地落后 N 个提交，需要先拉取」（本轮**不做** pull，见 §0.3）。

**验收口径**

- 点 `↑N` → 弹出菜单，能直接推送；推送后徽标消失。
- `↓N` 点击给出明确说明，而不是什么都不做。

---

## 8. LAYER —— 弹窗层级

### 8.1 事实核实（归因需要更正）

**现象成立，但归因不是「z-index 更低」。**

- 「切换工作区将丢弃打开文件中的未保存修改」= `ConfirmModal`（`src/client/ui.jsx:126-179`），文案 `i18n.js:946` `editor.unsavedSwitchRoot`。
- 「选择 IDE 项目」= `ProjectPicker`（`src/client/Workbench.jsx:492-554`），文案 `i18n.js:707`。
- **两者的遮罩用的是同一个类** `.iwb-modal-backdrop`（`src/client/styles.js:765-767`）：

  ```css
  .iwb-modal-backdrop {
    position: absolute; inset: 0; background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center; z-index: 50;
  }
  ```

  → **z-index 完全相等（都是 50）**，定位方式与包含块也相同（`.iwb-root` 是 `position: relative`，`styles.js:40-43`）。

- **真正的原因是 DOM 顺序**。`src/client/Workbench.jsx:779-787` 的渲染顺序：

  ```
  779  ConfirmModal        ← 未保存修改警告
  780  QuickOpen
  781  Toast
  782  RootPicker
  783  ProjectPicker       ← 「选择 IDE 项目」，排在 ConfirmModal 之后
  786  IndexDecisionModal  ← 有注释说明「画在项目选择框之上」
  787  SettingsModal
  ```

  同 z-index + 同包含块 → **后渲染的 ProjectPicker 压在上层**，确认框被完全遮住。

- **触发路径**：`src/client/store.js:992-999` 的 `selectProject()` 发现有 dirty tab → `askConfirm(...)`，**且不关闭 ProjectPicker**（`projectPicker` 仍为 `true`）→ 两个遮罩同时挂载。

- 对照：`IndexDecisionModal` 之所以能正常显示，是因为它被**故意**放在 `ProjectPicker` 之后（`Workbench.jsx:784-785` 有注释：「the index decision is drawn above the project picker: it is the answer to the choice the user just made in it」）。

- **z-index 全景**（`styles.js` 升序）：`1` 搜索文件头 → `2` 分组头 / 设置页底 → `3` modal 头 → `5` 分隔条 → `6` 顶栏 → `8` 搜索视图 → `11` Git 抽屉遮罩 → `12` HTML 操作条 / 目录树 / Git 抽屉浮层 → `13` 抽屉分隔条 → `14` DOM 查找条 → `30` 编辑器域遮罩 → `40/41` 菜单 → `42` 分支浮层 → **`50` 所有 modal 遮罩** → `60` Toast → `70` QuickOpen 遮罩。

### 8.2 LAYER-01 — 未保存修改警告必须高于「选择 IDE 项目」

**改法（已定：按第 1 种实施）**

1. **给「阻断式确认」单独一层**（**采用**）：
   - 在 `styles.js` 追加：

     ```css
     /* A blocking confirmation has to be above the dialog it answers. */
     .iwb-modal-backdrop.iwb-confirm-backdrop { z-index: 55; }
     ```

   - `src/client/ui.jsx:158-162` 的 `ConfirmModal` 把 backdrop 类改成 `'iwb-modal-backdrop iwb-confirm-backdrop'`（`scope === 'editor'` 的分支保持 `iwb-editor-scoped-backdrop`，那个是编辑器域的保存冲突框，与本条无关）。
   - 好处：**不动 DOM 顺序**，其它 modal 的相互关系不受影响。

2. ~~**调整渲染顺序**~~：**不采用**。把 `ConfirmModal` 移到 `ProjectPicker` 之后虽能解决，但以后再加别的弹窗还要重新排，容易再犯。

3. ~~**先关项目选择框再问**~~：**不采用**。`selectProject()` 里在 `askConfirm` 之前 `this.set({ projectPicker: false })` 会让确认框关闭后项目选择框也关了，用户想改选别的目录得重新打开。

**附加改进（同时做）**

- `ConfirmModal` 应当**阻止背景交互**：现在它和 ProjectPicker 的遮罩都是 `rgba(0,0,0,.45)`，两层叠加会变成 `0.70` 的黑幕，视觉上像「卡住了」。给 `.iwb-confirm-backdrop` 用**更深的**遮罩（`rgba(0,0,0,.6)`）并让下层遮罩保持不变，明确「当前只有这一件事要你决定」。
- 确认框文案补充**将要发生什么**：`editor.unsavedSwitchRoot` 现在是「切换工作区将丢弃打开文件中的未保存修改。」→ 改为「切换到 {target} 将丢弃 {count} 个打开文件中的未保存修改。保存后切换，还是放弃修改？」并提供**两个明确的动作**：`askConfirm`（`store.js:467`）目前只有一个动作 + 取消；改成**「保存并切换」/「放弃修改并切换」/「取消」**三选项更安全（`askChoice` 已存在，`store.js:2495-2505` 就在用）。

**验收口径**

- 当前项目有未保存修改 → 点「选择 IDE 项目」→ 选另一个项目 → **未保存警告出现在项目选择框之上**，看得见、点得到。
- 警告框的按钮点击后行为正确（保存 / 放弃 / 取消）。
- 不会出现「两层遮罩叠成纯黑」的情况。

---

## 9. 实施顺序与里程碑

| 里程碑 | 条目 | 理由 |
|---|---|---|
| **M0** | 前置核对 | 确认基线 commit 与本文件的锚点一致；跑一次 `npm test`（基线 549 项） |
| **M1** | **USAGE-01**（查找用法） | 独立、影响面小、用户可感知价值最高；且是 MEM-03 的诊断对象之一 |
| **M2** | **GIT-01**（文件粒度着色） | 一个参数改动解决一个明确缺陷；性能需实测 |
| **M3** | **MEM-01 + MEM-02 + SET-03**（内存模型） | 三者互相依赖：先有估算，再有提醒，再有设置项 |
| **M4** | **MEM-03 + MEM-04 + SET-01**（可见性 + 恢复 + 开关收敛） | 依赖 M3 的估算结果；依赖 `lsp.shutdown` 被客户端真正调用 |
| **M5** | **THEME-01..04**（配色与弹窗） | 独立于前面所有条目，随时可插队；与 M4 同批做（都是「体感」类） |
| **M6** | **FIND-01 + FIND-02**（查找弹窗） | 独立大项：需要扩搜索结果结构 + 新组件 + 键盘交互 |
| **M7** | **PUSH-01 + PUSH-02 + LAYER-01** | 小改动，快速收尾 |
| **M8** | **SET-02**（按语言启停） | 锦上添花 |

> **交付顺序**：M1 + M2 + M7 先走一轮（三个明确的缺陷/缺口，改动小、见效快），再走 M3–M5（内存与体感），最后 M6（查找弹窗，工作量最大）。

---

## 10. 测试要求

### 10.1 新增测试文件

| 文件 | 覆盖 |
|---|---|
| `tests/lsp-usage-references.test.mjs` | `WorkbenchWorkspace.requestFile`：未打开的文件也能返回文档；项目外返回 `null`；缓存生效 |
| `tests/lsp-memory-policy.test.mjs` | 新的 `#resourcesSnapshot` 判定：YAML 在 300 MB 可用内存下 `canIndex === true`；TS 在软阈值区间返回「紧张」；< 256 MB 拒绝；`needMB` 与 `thresholdBytes` 一致 |
| `tests/lsp-health-status.test.mjs` | 连续失败计数：3 次失败 → 状态栏「不稳定」且 `tone === 'warn'`；成功后归零；`degraded` 的 tone 是 `warn` 不是 `idle` |
| `tests/lsp-restart.test.mjs` | `restartLsp()`：先 `shutdown` 后 `start`；`lsp.enabled = false` 时宿主会话变 `idle`（进程退出） |
| `tests/git-untracked-files.test.mjs` | `parseStatusV2` 解析 `-uall` 的输出；`aggregateStatus` 对尾斜杠目录条目走 `dirs` 分支而不进 `files` |
| `tests/search-popup.test.mjs` | 查找弹窗：打开不新增 tab；单击只预览不跳转；双击跳转并关闭；`Esc` / 遮罩 / ✕ 关闭 |
| `tests/modal-layer.test.mjs` | 未保存修改警告的 z-index 高于项目选择框；两者都存在时确认框可点 |
| `tests/styles-theme.test.mjs` | 样式表扫描：不存在 `#1b1e24`、`#d8dce3`、`#7fb8ff`、`rgba(255,255,255`、`CodeEditor.jsx` 的旧语法色板 |

### 10.2 现有测试的回归要求

- `tests/lsp-*.test.mjs`：**内存判定逻辑变了**，所有断言 `canIndex` / `thresholdBytes` 的用例都要按新模型更新（注意：这些用例断言的是**行为**，不要为了通过而改行为）。
- `tests/git-*.test.mjs`：`git status` 的参数变了，**mock 出来的 stdout 也要改成 `-uall` 的形态**（`? a/b.js` 而不是 `? a/`）。
- `tests/search*.test.mjs` / `tests/editor-*.test.mjs`：查找从 tab 改成弹窗，相关的 tab 断言要改。
- `tests/settings-*.test.mjs`：设置 schema 可能有变动（`memoryBaselineMB` / `memoryHeadroom` / `memoryHardFloorMB`），补迁移用例。

### 10.3 交付前检查

- `npm test` 全绿（基线 549 + 本轮新增）。
- `npm run build` 成功；`dist/client.js` 体积增量 **≤ 150 KB**（本轮没有新依赖，主要是样式与组件）。
- i18n：所有新增 key 在 **en 与 zh-CN** 两个表里都有值（`src/client/i18n.js`）。
- **浅色 + 深色**两种宿主主题下各走查一遍：悬停卡、补全弹窗、引用面板、索引决策弹窗、查找弹窗。

### 10.4 实机验收清单（自动化覆盖不到的部分）

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

## 11. 风险与回归清单

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| 1 | `git status -uall` 在超大仓库变慢 | 文件树状态刷新变慢 | 先实测；必要时退回「按需展开」方案（§5.2） |
| 2 | 新的内存门槛比原来**宽松**，可能让机器更早 OOM | 语言服务器被杀、宿主受影响 | 保留 `memoryLimitMB` 作为上限（继续注入 `maxTsServerMemory`）；崩溃后仍走 `autoRestart`（已修，见 D7/D10） |
| 3 | `requestFile` 一次查找读几十个文件 | 查找变慢 / 磁盘 IO 抖动 | 按 uri 缓存 + 容量上限 + 查找结束清空（§3.2） |
| 4 | 引用面板一次列几百条 | 面板卡顿 | 沿用库自带的面板滚动；超阈值时提示「只显示前 N 条」 |
| 5 | 查找结果结构扩了 `before`/`after` | 宿主返回的 JSON 变大 | 只给前若干条命中带上下文；总量上限 2 MB（§6.3） |
| 6 | 状态栏新增 `warn` 态 | 与已有的 `building`（也是 `warn`）视觉撞车 | 用不同的圆点形状或文案前缀区分（「不稳定」vs「索引中」） |
| 7 | 关闭开关时多一次 `lsp.shutdown` 调用 | 切项目时序可能受影响 | 只在 `enabled` 由 true→false 时调用；失败只记日志不打断切项目 |
| 8 | 弹窗抢走快捷键（`Esc` / `↑↓` / `Enter`） | 影响编辑器输入 | 弹窗打开时 `stopPropagation`；输入框聚焦时优先处理 |
| 9 | 查找从 tab 改成弹窗，破坏了「F8 循环」的肌肉记忆 | 用户不适应 | 保留 `F8` / `Shift+F8` 在弹窗内循环命中；快捷键不变 |
| 10 | 弹窗遮罩与现有 `.iwb-modal-backdrop` 同为 `position: absolute` | 层级错乱 | 沿用 QuickOpen 的 `z-index: 70`（高于所有 modal），不复用 50 |
| 11 | 语法色板改动影响编辑器观感 | 大面积视觉变化 | THEME-03 的 fallback 色**逐类**在浅色底上验证过再合入 |
| 12 | `lsp.enabled` 改标签但不改字段 | 老用户配置语义漂移 | 字段不变、只改文案；在 CHANGELOG 里写明「该开关即构建代码索引」 |

---

## 12. 交付物

| # | 交付物 | 位置 |
|---|---|---|
| 1 | 宿主：内存估算模型与分级阈值 | `src/host/lsp.js` |
| 2 | 宿主：`lsp.start` 支持 `force`、返回估算字段 | `src/index.js`、`src/host/lsp.js` |
| 3 | 宿主：未跟踪文件粒度 | `src/host/git.js` |
| 4 | 宿主：搜索结果带上下文 | `src/host/search.js` |
| 5 | 客户端：workspace 的 `requestFile` 与内容缓存 | `src/client/lsp-workspace.js` |
| 6 | 客户端：语义健康度计数与状态栏合成 | `src/client/lsp-session.js`、`src/client/store.js`、`src/client/Workbench.jsx` |
| 7 | 客户端：重新建立索引 / 降级为保守版 | `src/client/store.js`、`src/client/Workbench.jsx` |
| 8 | 客户端：索引决策弹窗精修 + 内存提醒弹窗 | `src/client/Workbench.jsx`、`src/client/styles.js` |
| 9 | 客户端：查找结果弹窗 | `src/client/SearchPopup.jsx`（新）、`src/client/store.js`、`src/client/EditorArea.jsx` |
| 10 | 客户端：独立推送按钮 + 可点的 `↑N` | `src/client/CommitPanel.jsx`、`src/client/Workbench.jsx` |
| 11 | 客户端：弹窗层级修正 | `src/client/ui.jsx`、`src/client/styles.js` |
| 12 | 样式：主题令牌化 | `src/client/styles.js`、`src/client/CodeEditor.jsx` |
| 13 | 设置项与文案 | `src/client/SettingsPanel.jsx`、`src/host/settings-store.js`、`src/client/i18n.js` |
| 14 | 测试 | `tests/**` |

---

## 附录 A —— 关键锚点速查

**宿主**

| 位置 | 内容 |
|---|---|
| `src/host/lsp.js:49-102` | `LSP_REGISTRY`（每语言 `memoryLimitMB`） |
| `src/host/lsp.js:104-115` | `DEFAULT_LSP_SETTINGS`（`memoryLimitMB: 2048`、`freeMemoryThresholdMB: 2048`） |
| `src/host/lsp.js:141-144` | 状态机 `TRANSITIONS` |
| `src/host/lsp.js:735-742` | `resources()` 对外快照 |
| `src/host/lsp.js:1047-1058` | `#resourcesSnapshot`（**一刀切的根源**） |
| `src/host/lsp.js:1175-1179` | 启动前的内存预检 |
| `src/host/lsp.js:1805-1809` / `:1826-1830` | 重启前的内存预检 |
| `src/host/lsp-ws.js:112-115` | WS 关闭只 `detach()`，不停进程 |
| `src/host/git.js:55-60` | git 的 `-c` 覆盖项 |
| `src/host/git.js:143-215` | `parseStatusV2` |
| `src/host/git.js:205-208` | 未跟踪条目解析 |
| `src/host/git.js:269` | `git status` 参数（**缺 `-uall`**） |
| `src/host/git.js:401-405` | `push()` |
| `src/host/search.js:30` / `:103-115` / `:114` | `MAX_RESULTS` / `previewOf` / 每文件命中上限 |
| `src/host/workspace.js:294` | `'path is a directory'` |

**客户端**

| 位置 | 内容 |
|---|---|
| `src/client/styles.js:11-38` | `--iwb-*` 变量（包着 `--dsw-alias-*`） |
| `src/client/styles.js:765-771` | `.iwb-modal-backdrop`（z-index 50）/ `.iwb-modal` |
| `src/client/styles.js:878` | `.iwb-search`（填充式） |
| `src/client/styles.js:910-925` | `.iwb-quick-*`（弹窗范式，z-index 70） |
| `src/client/styles.js:1032-1163` | 智能代码的全部样式（**硬编码色值集中区**） |
| `src/client/styles.js:1192-1200` | `.iwb-index-decision` |
| `src/client/CodeEditor.jsx:126-140` | `HIGHLIGHT` 语法色板 |
| `src/client/CodeEditor.jsx:142-166` | `THEME`（编辑器主题，已用 `var(--iwb-*)`） |
| `src/client/CodeEditor.jsx:765-770` | `usageAvailable` / `definitionAvailable` |
| `src/client/CodeEditor.jsx:802-813` | 语义查找用法的菜单项 |
| `src/client/lsp-session.js:75-93` | `redirectErrorsToToast`（**失败不回写状态**） |
| `src/client/lsp-session.js:244-248` | `requestTimeoutOf` |
| `src/client/lsp-session.js:255-279` | `capabilityAvailable` / `semanticUsagesAvailable` |
| `src/client/lsp-session.js:355-381` | `refreshLsp`（`enabled` 的开关逻辑） |
| `src/client/lsp-workspace.js:196-434` | `WorkbenchWorkspace`（**缺 `requestFile`**） |
| `src/client/store.js:172-189` | `state.search` 切片 |
| `src/client/store.js:992-1001` | `selectProject`（未保存确认） |
| `src/client/store.js:1030-1049` | `#decideIndex`（`enabled=false` → 不问） |
| `src/client/store.js:1136-1141` | `#startLsp` |
| `src/client/store.js:1431-1480` | `refreshLspStatus`（2 秒轮询） |
| `src/client/store.js:1882-1940` | `openSearchTab` / `findUsagesText` |
| `src/client/store.js:3096` / `:3177-3186` | `commit` / `push` |
| `src/client/store.js:2820-2827` | `changedEntries` / `commitGroups` |
| `src/client/Workbench.jsx:84-89` | `↑N` / `↓N` 徽标 |
| `src/client/Workbench.jsx:281-345` | `lspStatusView` |
| `src/client/Workbench.jsx:354-392` | `LspStatus` 组件 |
| `src/client/Workbench.jsx:492-554` | `ProjectPicker` |
| `src/client/Workbench.jsx:563-623` | `IndexDecisionModal` |
| `src/client/Workbench.jsx:779-787` | **弹窗渲染顺序（层级问题的根因）** |
| `src/client/EditorArea.jsx:215-242` | `TabBar`（搜索 tab 与文件 tab 同级） |
| `src/client/EditorArea.jsx:753-763` | 搜索视图在内容区渲染 |
| `src/client/SearchView.jsx:114-201` | 搜索视图结构 |
| `src/client/QuickOpen.jsx:61-103` | 弹窗范式（可复用） |
| `src/client/ui.jsx:126-179` | `ConfirmModal` |
| `src/client/CommitPanel.jsx:153-156` | `openChange`（目录条目报错点） |
| `src/client/CommitPanel.jsx:288-299` | 提交 / 提交并推送按钮 |
| `src/client/ProjectPanel.jsx:874-877` | 树行的状态查询（目录查 `dirs`，文件查 `files`） |
| `src/client/git-colors.js:86-109` | `aggregateStatus` |
| `src/client/SettingsPanel.jsx:382-462` | 【语义分析】设置组 |

**第三方**

| 位置 | 内容 |
|---|---|
| `node_modules/@codemirror/lsp-client/dist/index.js:200-202` | `Workspace.requestFile`（**只认已打开的文件**） |
| `node_modules/@codemirror/lsp-client/dist/index.js:294-300` | `lspTheme`（只定义间距，不定义颜色） |
| `node_modules/@codemirror/lsp-client/dist/index.js:1071` | 悬停卡的类名 |
| `node_modules/@codemirror/lsp-client/dist/index.js:1600-1622` | `findReferences`（**过滤掉拿不到文件的引用**） |

## 附录 B —— 术语对照

| 词 | 含义 |
|---|---|
| **保守版** | 没有语言服务器时的降级形态：本地补全 + 文本查找引用 |
| **索引 / 构建索引** | **不是**磁盘上的索引文件。＝ 启动语言服务器并等它完成首次 program 构建（PRD-v5 §0.2 #1）。THEME-04 要把用户可见文案改掉 |
| **上游 / upstream** | 当前分支追踪的远端分支；`ahead` 是领先它的提交数 |
| **项目 / Project** | 工作区里的一个子目录，决定文件树、Git 仓库与终端的根 |
