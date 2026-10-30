# dsh-ide-toolwindows V3 待改进说明

> 体验审计报告 · 第三轮迭代的核心输入
>
> | | |
> |---|---|
> | 审计对象 | `dsh-ide-toolwindows` 0.3.0（HEAD `7eb0373`） |
> | 审计日期 | 2026-10-22 |
> | 审计方式 | 源码与构建产物逐行走查 + 65 项自动化测试 + 真实 git 仓库复现 + DSH Desktop 实机 UI 走查（40+ 张截图）+ 用户实机截图 |
> | 结论 | **做成了"像 IDE 的壳"，但还没做成"能日常替代 IDE 的工具"**。当前阻碍"必装"的不是功能数量，而是搜索、Git 浏览、状态语义、数据安全四条主链路上的硬伤。 |
> | 建议 | V3 不做新工具窗、不追平 Floating/Split/Local History；把 4 个核心日常回路做到 4.5/5，并清掉所有"承诺了但没兑现"的快捷键与设置。 |

---

## 0. 一页结论

### 0.1 总评

如果把 JetBrains IDEA / WebStorm 作为 5 分基准：

| 使用场景 | 当前分 | 判断 |
|---|---:|---|
| 作为"能看代码的浏览器" | **4.0** | 文件树、标签、Markdown 渲染、Diff 都已成型，视觉方向正确。 |
| 作为"能改代码的编辑器" | **2.5** | 默认只读、只读态不可复制、搜索缺失、Tab 生命周期不完整。 |
| 作为"能查代码的 IDE" | **0.5** | 没有文件内查找、没有全局查找、没有快速打开；树过滤只覆盖已加载目录。 |
| 作为"能提交的 Git 客户端" | **2.5** | 提交分组与行级暂存很强，但历史/详情布局、筛选、分支入口不合格。 |
| 作为"能长期开着的工具窗" | **1.5** | 切到对话/切到 Git 就销毁终端；轮询重；面板切换丢上下文。 |
| **综合** | **2.2 / 5** | 一个很好的骨架，但距离"用户必装"还差 4 个必须补齐的闭环。 |

### 0.2 五条"必装门槛"

不解决下面五条，功能做得再多也只是"可以试用"：

1. **搜索闭环**：`Ctrl+F` 文件内查找可用、可复制、有计数；`Ctrl+Shift+F` 全局查找可用；能按文件名快速打开。缺一不可。
2. **Git 浏览闭环**：提交历史与详情必须是"左右分栏 + 显式抽屉"，单击只选中、双击才开销；详情要有文件状态、行数统计、可操作的 diff。
3. **状态语义闭环**："当前打开的文件"与"我选中的文件"必须是两种视觉；树/提交列表/日志三处的选中模型要一致。
4. **数据安全闭环**：编辑内容不能被静默覆盖；关闭未保存标签时必须能"保存"；回滚必须真的回滚；删除失败不能静默永久删除。
5. **键盘可信闭环**：菜单上写的快捷键必须有实现；`Ctrl+A` 不能把选择泄漏到 DSH 侧栏；F11/Ctrl+K 不能被抢到聊天输入框里。**（实机修正：点击树行后 F2/ArrowDown 实际可用，焦点不是问题；问题在"承诺未实现"和"泄漏到宿主"。）**

### 0.3 本轮建议只承诺三个"可感知跃迁"

- **搜索从 0 到 1**：文件内 FindBar + 全局 Find in Files + 快速打开。
- **Git 从"能看"到"能工作"**：Drawer 详情 + 完整筛选 + 分支入口重做。
- **编辑从"能改"到"敢用"**：默认可编辑、可复制、未保存保护、快捷键可信。

其余列为 P1/P2，按第 11 章里程碑排期。**不要在本轮加入 Local History、Cherry-pick、Floating/Split 等新能力**，那会把"修硬伤"再次挤掉。

### 0.4 P0 清单（开工前先对齐）

| ID | P0 问题 | 一句话验收 | 详见 |
|---|---|---|---|
| SRCH-01 | 只读态没有文件内查找，编辑态只有 CM 默认面板 | 任意视图 `Ctrl+F` 出现统一 FindBar，有计数与 F3 循环 | §3.3 |
| SRCH-02 | CM 面板英文/黑块/遮挡/无计数 | 不再出现英文短语与黑块按钮 | §3.1/§3.3 |
| SRCH-03 | 没有全局 Find in Files（快捷键是死的） | `Ctrl+Shift+F` 按文件分组返回结果，可取消、可定位 | §3.4 |
| TREE-01 | 打开的标签与选中文件同色 | 打开=粗体，选中=蓝底，失焦=灰蓝 | §5 |
| EDIT-02 | 只读代码/Diff 文本不可选中复制 | 拖选 + `Ctrl+C` 内容一致 | §7.1 |
| EDIT-03 | 关闭脏标签没有"保存"；Close Others 静默保留 | 三按钮确认 + 批量关闭保护 + beforeunload | §7.3 |
| COMMIT-03 | 回滚对"仅暂存"文件无效 | 回滚后 `git status` 干净 | §7.4 |
| UX-02 | 回收站失败时静默永久删除 | 回收站失败必须二次确认 | §7.4 |
| UX-01 | 确认框默认聚焦"确认"，Enter 直接执行 | 默认焦点在取消，Esc 取消，Enter 不误确认 | §7.6 |
| TERM-01 | 切对话/切 Git 杀死终端会话 | 切走 10s 回来，进程与 scrollback 保持 | §7.2 |
| GIT-01 | 历史与详情上下堆叠，270px 高不可用 | 日志全高 + 右侧 Drawer，可拖宽 | §4.2 |
| GIT-02 | 单击立即拉详情，双击又开重复标签 | 单击只选中，双击/Enter 开 Drawer | §4.2 |
| GIT-03 | 两个分支下拉，第一个是危险 checkout | 筛选只有一个下拉且不改 HEAD；切换走分支弹层+确认 | §6 |
| KEY-01 | 菜单/设置承诺的十多个快捷键无实现 | 菜单可见 = 快捷键可用（Action Registry） | §7.5 |
| KEY-02 | F11/Ctrl+K 等全局抢占聊天输入框 | 编辑类快捷键按焦点作用域；F11 不全局接管 | §7.5 |

### 0.5 对你提出的 4 点，结论与处理

| 你的反馈 | 审计结论 | 处理方案 | 验收 |
|---|---|---|---|
| 1. 文件内搜索差、似乎没有全局搜索 | **完全成立，而且比你说的更严重**：实机只读态 `Ctrl+F` 完全无反应；编辑态是 CodeMirror 未本地化的默认面板（黑块/英文/无计数）；`Ctrl+Shift+F` 实机无反应。另外，只读代码**连选中复制都不行**（实机剪贴板保持 baseline），搜索和复制一起坏。 | 新 FindBar（只读/编辑/Diff/Markdown）+ Find in Files + 快速打开；修 CM 样式/i18n；先修可复制。 | §3.7、§7.1、§12.1 |
| 2. Git 提交历史/详情挤在有限空间；单击就弹详情，违背"单击选中、双击展开" | **完全成立，且根因在 PRD**：§6.1 写"上下分栏"，§6.3 又写"单击选中、双击打开"。实机：单击 `2ede1a6` 后日志只剩约 5 行，详情被窗口底部截断；双击 `52216f9` 打开一个从 README 开始的巨型 diff 标签。 | 日志全高 + 右侧 Drawer；单击只选中、双击/Enter 开详情；详情结构化（文件状态/统计/内联 diff/父提交/复制/动作）。 | §4、§12.2 |
| 3. 打开标签的文件与单击选中的文件同色 | **完全成立**：实机 `package.json` 打开、`package-lock.json` 选中时两行同时蓝；选中 `LICENSE` 后 `package.json` 仍保持蓝色。代码两处复用 `itw-selected`，也没有"失焦弱化"和"打开 vs 选中"模型。 | 四状态模型（Open/Selected/Inactive/Focus）；打开=粗体、选中=蓝底、失焦=灰蓝；同步到 Commit 列表与 Git 日志。 | §5、§12.3 |
| 4. 两个筛选分支的下拉 | **完全成立，而且第一个是危险写操作**：实机筛选行并排两个 `main` 下拉；顶部 `main` chip 点击无任何反应；改变第一个下拉会 `git checkout`，没有确认、没有脏工作区检查。 | 筛选行只留一个分支筛选；切换分支移到顶部 Branch 弹层，带搜索/确认/脏工作区阻止。 | §6、§12.2 |

> 一句话：你提的 4 点全部成立；其中第 1 点还牵出"只读不可复制"，第 4 点还牵出"筛选控件带写副作用"，
> 这两条是本轮最优先修的 P0。

---

## 1. 审计方法与证据

### 1.1 方法

- **静态走查**：`src/client` 与 `src/host` 全量阅读，包括 `dist/client.js` 构建产物（确认与源码一致）。
- **自动化**：`npm test`，65 项全部通过；说明问题主要不在"逻辑写错"，而在"交互规格缺失/取舍错误"。
- **真实 git 复现**：在本仓库与临时仓库验证 `restore`、`log --grep`、分页、状态轮询成本。
- **实机 UI 走查（2026-10-22 23:09–23:45）**：在运行中的 DSH Desktop 0.3.0 上用 Windows UI 自动化做了一轮**只读**验收，采集 40+ 张截图；关键 14 张已存入 [`docs/assets/v3-live/`](assets/v3-live/)。未执行保存、提交、删除、回滚、切分支等破坏性操作。
- **实机修正**：此前基于通用 Chromium 推断的"点击树行后焦点丢失、F2 失效"**不成立** —— 实机 F2 可进入重命名、ArrowDown 可移动选中；但同一次走查发现了新的 **Ctrl+A 泄漏到 DSH 侧栏**问题（见 E4）。
- **实机证据**：用户提供的两张运行截图（下称 **图 1 / 图 2**）+ `docs/assets/v3-live/` 下的 14 张本轮截图。

> **审计边界**：实机走查覆盖搜索入口、只读/编辑复制、树焦点与高亮、Git 单击/双击/分支 chip、终端切换、设置、右键菜单。
> **未覆盖**：保存/外部修改冲突、删除/回滚的 UI 流程、分支切换（只观察未执行）、拖拽、亮/暗主题与 DPI、10k 文件仓库性能、Markdown/Diff 内查找。
> 第 3–6 章中标注"建议 / 目标 / 规格"的内容是设计提案，不是现状描述；第 12 章区分"已实机确认"与"待验收"。

### 1.2 关键证据速查

| 证据 | 内容 | 位置 |
|---|---|---|
| E1 | 只读代码/差异不可选中复制；编辑态可复制 | 实机确认：只读拖选 + `Ctrl+C` 后剪贴板仍是 baseline；编辑态复制出 70 字符；提交 diff 拖选无效且 `Ctrl+C` 复制到了侧栏文本。`styles.js:53`，`CodeView.jsx:130-188`，`DiffView.jsx:300-324`；截图 `02-readonly-copy-blocked.png` |
| E2 | 默认只读；`Ctrl+F` 在只读态无反应；编辑态才挂 CodeMirror 默认搜索 | 实机确认：只读按 `Ctrl+F` 无任何 UI；编辑态按 `Ctrl+F` 出现 CM 面板。`store.js:961`，`EditorArea.jsx:102-138`，`CodeEditor.jsx:135-141`；截图 `03-codemirror-search.png` |
| E3 | CodeMirror 默认面板英文文案与黑色按钮 | 实机确认：`Find / Replace / match case / regexp / by word` 全部英文，按钮为黑块。`dist/client.js:34912-34962`；截图 `03-codemirror-search.png` |
| E4 | **实机修正**：树焦点可用；`Ctrl+A` 未实现并选中了 DSH 侧栏文本 | 实机：点击行后 `F2` 进入重命名、`ArrowDown` 移动选中；`Ctrl+A` 选中"新会话/插件/自动化任务/上下文洞察/IDE 工具窗口"等侧栏文本，树节点未被全选。`ProjectPanel.jsx:602-611`；截图 `11-f2-works.png`、`08-ctrl-a-leak.png` |
| E5 | Git 历史与详情上下堆叠，详情 `max-height: 42%` | 实机确认：单击后日志只剩约 5 行，详情被窗口底部截断。`GitPanel.jsx:358`，`styles.js:511-513`；截图 `04-git-single-click.png` |
| E6 | 单击提交立即拉详情；双击又开一个提交标签 | 实机确认：单击 `2ede1a6` 立即出现详情；双击 `52216f9` 打开巨型 diff 标签。`GitPanel.jsx:328-332`，`store.js:1664-1675`；截图 `04/05` |
| E7 | 两个几乎一样的分支下拉，第一个是"切换分支"写操作；顶部 branch chip 不可点 | 实机确认：筛选行并排两个 `main` 下拉；点击顶部 `main` chip 无任何反应。`GitPanel.jsx:220-233`、`249-256`；图 2 |
| E8 | 打开的标签与选中的文件使用同一个 `itw-selected` 类 | 实机确认：`package.json` 打开、`package-lock.json` 选中时两行同时蓝；选中 `LICENSE` 后 `package.json` 仍保持蓝色。`ProjectPanel.jsx:504-508`，`styles.js:302`；截图 `01-two-highlights.png` |
| E9 | 终端随面板卸载销毁（切换 Git 或回到对话都会） | 实机确认：Git→Terminal 后 scrollback 被清空、只剩新提示符；回对话再回 IDE 后底部终端面板直接关闭。`store.js:494-503`，`TerminalPanel.jsx:142-152`，`index.js:489-492`；截图 `06/07` |
| E10 | 回滚对"仅暂存"文件无效（真实 git 复现） | `host/git.js:329-332`，附录 B.2 |
| E11 | 回收站失败时静默永久删除 | `host/fileops.js:245-247` |
| E12 | 全局快捷键不区分焦点；F11 在聊天框也会被拦截 | `index.jsx:130-165` |
| E13 | 每 2 秒跑 3 条 git 子进程；本仓库实测约 243ms/轮 | `store.js:483`，`host/git.js:236-249`，附录 B.3 |
| E14 | 整个状态树一个快照，光标/每敲一个字都触发全工作台重渲染 | `hooks.js:4-5`，`store.js:157-160` |
| E15 | README 声称"所有快捷键可重绑"，设置页实机只显示 6 个 | 实机确认：设置弹窗只列 Project/Commit/Git/Terminal/Focus commit/Push 六项；`README_ZH.md:27`，`SettingsPanel.jsx:9-16`；截图 `12-settings.png` |
| E16 | 实机走查：40+ 张截图，2026-10-22 23:09 起 | `docs/assets/v3-live/` |
| E17 | 树过滤只覆盖已加载目录：输入 `store.js` 后所有顶层目录显示"加载中..."，没有结果 | 实机确认；截图 `14-tree-filter-loading.png`；`ProjectPanel.jsx:60-109` |

---

## 2. 用户旅程复盘

### J1 打开文件，读，复制一段代码

**期望**：双击/单击打开 → 拖选 → `Ctrl+C` → 粘到聊天里问 AI。

**实际**：

- 双击文件能打开，但**新标签默认是只读**（实机：新开 `package.json`，工具栏显示"编辑"）；"编辑"按钮不显眼。
- 在只读代码区拖选，**选不中**（实机：拖选后剪贴板仍是 baseline）；`Ctrl+A` 也不会只选代码，而是选中了 **DSH 侧栏**的"新会话/插件/…"文本（实机，E4）。
- `Ctrl+F` 在只读态**完全无反应**（实机：DSH Desktop 中没有浏览器查找、也没有插件 FindBar）；Web 端可能落回浏览器查找，但同样不是 IDE 查找。
- 切到编辑态后按 `Ctrl+F`，出现 CodeMirror 默认面板：英文 "Find / Replace / match case / regexp / by word"，按钮显示为黑块（实机截图 `03-codemirror-search.png`，E3），没有匹配计数，遮住正文。
- 编辑态下代码可以拖选复制（实机复制出 70 字符），但**提交 diff 仍然无法选中**；`Ctrl+C` 复制到的是之前 `Ctrl+A` 选中的侧栏文本（实机）。
- 想把一段 diff 贴给 AI，同样做不到。

**结论**：这是"必装"的第一杀手。用户打开插件的第一件事通常是"读 + 复制"，当前在这一步就失败了。

### J2 改一行，保存，提交

**期望**：打开即写 → `Ctrl+S` → `Alt+0` 看改动 → 勾选 → 写消息 → `Ctrl+Enter`。

**实际**：

- 打开默认只读，需要先点"编辑"。
- 保存链路本身不错（原子写、BOM/编码保持、脏点、关闭确认），但关闭确认只有"放弃/取消"，**没有"保存并关闭"**。
- Commit 面板在 300px 宽内**实际能放下核心控件**（实机 `10-commit-panel.png`），不是"挤爆"；真正的问题是 `提交并推送` 被降级为消息框下方的小字链接，可发现性差；分组不可折叠、未跟踪行不着色。
- 勾选文件的乐观 UI 与 `git add` 失败之间没有回滚（COMMIT-02），可能出现"勾着但没暂存"。
- 回滚对已暂存文件不生效（E10）；删除在回收站失败时会静默永久删除（E11）。

### J3 回看某次提交

**期望**：打开 Git → 点一条 → 右侧出现详情 → 看文件列表 → 点文件看 diff。

**实际**：

- 单击提交立即把下方详情挤出来（实机：日志只剩约 5 行，详情被窗口底部截断，E5/E6）；详情区最高只有 42%、还要再滚动。
- 双击提交又会打开一个"提交 diff"标签（实机：`52216f9` 打开一个从 README.md 开始的巨型 diff），和下方详情内容重复。
- 详情里只有：subject、hash、作者、邮箱、日期、refs、正文、文件名列表、总 `+/-`。
- 没有单文件状态图标、没有单文件 `+N −M`、没有内联 diff、没有父提交跳转、没有复制 hash、没有 Revert/Cherry-pick/Checkout 等操作。
- 文件列表是从 `diff --git` 文本里正则抠出来的，带空格/引号/重命名的路径可能出错。
- 分支切换藏在筛选行第一个下拉里，改一下就直接 checkout，无确认。

### J4 找一段实现

**期望**：`Ctrl+Shift+F` 搜内容，或 `Ctrl+Shift+N` 按文件名跳。

**实际**：

- `Ctrl+Shift+F` 在设置里有、在 PRD 里有、在菜单里没有、在代码里没有（KEY-01）；**实机按下无任何反应**。
- 树头部搜索框只是过滤**已加载且已展开**的目录；在折叠的大仓库里输入文件名，结果为空，也不显示"正在搜索/没有匹配"。
- 无快速打开、无最近文件、无 Search Everywhere。
- 只能手工展开目录找，回到"文件管理器"时代。

### J5 一边和 AI 对话，一边跑命令

**期望**：在 Terminal 里跑 `npm run dev` → 切到对话问问题 → 切回来，进程还在、输出还在。

**实际**：

- 切到对话，工作台卸载，`deactivate()` 清空终端会话；切到 Git 页签，`TerminalPanel` 卸载，socket 关闭，宿主在 grace 期后终止 PTY（E9）。
- 切回来是一个**新的 shell**，`npm run dev` 已经没了，scrollback 也没了。**实机：Terminal→Git→Terminal，之前的 `ITW_CHAT_TEST` 输出消失，只剩新提示符；Terminal→对话→IDE，底部终端面板直接关闭。**
- 对一个 DSH 插件来说，"切回对话"是最高频动作，这等于终端不可用。

**结论**：J1/J3/J4/J5 四条回路都断在"日常必用"的位置。V3 的任务不是"再加功能"，而是把这四条接上。

---

## 3. 必改问题一：搜索（P0-1）

### 3.1 现状与根因

**现象**

1. 只读态无文件内查找；编辑态是 CodeMirror 默认面板，英文、黑块、无计数、遮挡正文。**实机：只读按 `Ctrl+F` 无任何反应；编辑态按 `Ctrl+F` 出现该面板（截图 `03-codemirror-search.png`）。**
2. 无全局 Find in Files；`Ctrl+Shift+F` 是死快捷键。**实机：按下无任何反应。**
3. 无快速打开/最近文件/Search Everywhere。
4. 树过滤只覆盖"已加载"目录，且没有匹配高亮与结果计数。
5. Markdown 预览、Diff/提交 Diff 内均无查找。**实机：提交 diff 拖选无效，`Ctrl+C` 复制到的是侧栏文本。**

**根因（不只是实现问题，是 PRD 缺口）**

- PRD-v2 第 4.8 节只定义了"树内按名称过滤"，**没有定义文件内查找**；8.3 的 Search Everywhere 被标为"V2.2 预留"。实现者于是把 `Ctrl+F` 交给了 CodeMirror 的默认面板，而默认面板既没有本地化，又疑似与插件的全局 `button` reset 发生样式层叠冲突（实机黑块，需实现时复核并隔离）。
- PRD 没有为"查找"定义统一服务：无 `fs.search`、无结果模型、无取消、无高亮协议。于是 Project 树过滤、编辑器查找、Git 搜索各自为政，用户看到的是三种不同质量的"搜索"。

**竞品基线**

| 能力 | IDEA / VS Code | 当前 |
|---|---|---|
| 文件内查找 | 顶部 FindBar，计数 `n/m`，Aa/W/.*，F3 循环，高亮全部 | 无 / CM 默认面板 |
| 全局查找 | Find in Files，按文件分组，流式、可取消、可包含/排除 | 无 |
| 快速打开 | `Ctrl+Shift+N` / `Ctrl+P` 模糊文件名 | 无 |
| 树过滤 | 过滤可见树并自动展开命中 | 只过滤已加载 |
| Diff/Markdown 内查找 | 支持 | 无 |

### 3.2 目标体验：三个入口，一套搜索模型

```
入口 1  Ctrl+F            当前编辑器/差异内的查找条
入口 2  Ctrl+Shift+F      全项目内容查找（新 Search 页）
入口 3  Ctrl+Shift+N      按文件名快速打开
        Ctrl+Shift+A      命令面板 / Search Everywhere
```

三者共享一套 `SearchQuery` 模型：`text / caseSensitive / wholeWord / regex / scope / include / exclude`。
不要把 `Ctrl+F` 再交给 CodeMirror 的默认面板。

### 3.3 文件内查找（FindBar）规格

**布局**

```
┌ 查找 ────────────────────────────────────────────────────────────┐
│ [ 搜索内容                 ]  3/17  ‹  ›   Aa  W  .*   仅选区  × │
│ [ 替换为                   ]  [替换] [全部替换]        （编辑态） │
└──────────────────────────────────────────────────────────────────┘
```

- 位置：编辑器右上角浮层（`top: 6px; right: 16px`），宽度自适应 `min(520px, 100% - 32px)`；不改变正文布局，不遮住光标所在行（必要时向下偏移）。
- 输入即搜（80ms 防抖）；显示 `当前/总数`；无结果显示红色"无结果"。
- 高亮所有命中；当前命中使用更醒目的背景 + 1px 描边。
- `Enter` 下一个、`Shift+Enter` 上一个；`F3/Shift+F3` 全局下一个/上一个；`Esc` 关闭并把焦点还给编辑器。
- 打开时若编辑器有选中文本，自动填入查询（JetBrains 行为）。
- 查询按标签页记忆；关闭标签页时清理。
- 只在编辑态显示"替换"行；只读态隐藏替换。

**各视图的实现方式**

| 视图 | 方案 |
|---|---|
| 只读代码（CodeView） | 在行内计算匹配区间，渲染 `<mark>`；虚拟化只渲染可见行，但计数/上一个/下一个基于全文索引；上限 5000 条，超出显示 `5000+` |
| 编辑代码（CodeMirror） | 继续使用 `@codemirror/search` 的 `SearchQuery` + `setSearchQuery`/`findNext`/`findPrevious`，但**不打开默认面板**，由我们的 FindBar 驱动；保留 `highlightSelectionMatches` |
| Markdown 预览 | 优先用 CSS Custom Highlight API 在渲染后的 DOM 上高亮并滚动；不可用时提示"切换到源码查找"并一键切换 |
| Diff / 提交 Diff | 对每个文件的每一行做匹配，跨文件 `n/m`；`Enter` 跨文件跳转；行内高亮；当前命中滚动到视口中央 |
| 图片/二进制 | FindBar 禁用并显示"该文件不可搜索" |

**必须同时修掉的样式问题**

- `.itw-root button { background:none; border:0; padding:0 }` 极可能污染 CodeMirror 面板按钮的样式层叠；**实机已确认按钮呈黑块**。无论根因是什么，必须做隔离：优先把全局 reset 限定到插件自有按钮类（给插件按钮加统一 class），而不是对所有 `button` 生效；或把 CM 面板放进独立的 reset 作用域。改完后用浅/暗主题各截图验收。
- 所有查找 UI 走插件自己的主题令牌，亮/暗主题都要检查对比度。
- 英文文案全部走 i18n，不允许出现 CodeMirror 的 `Find / Replace / match case / by word`。

### 3.4 全局查找（Find in Files）规格

**入口与形态**

- `Ctrl+Shift+F` 打开一个新的 **Search 编辑器标签页**（不是弹窗，不是底栏临时面板），保留查询与结果，直到用户关闭。
- Project 头部搜索图标改为**分裂按钮**：左键 = 树内快速过滤，右键/下拉 = "在文件中查找…"。
- Project 右键目录 → "在目录中查找…"；编辑器选中文本右键 → "在文件中查找选中内容"。

**布局**

```
┌ 在文件中查找 ─────────────────────────────────────────────────────┐
│ [ 搜索内容................ ]  Aa  W  .*   范围: 项目 ▾   ⚙  ×    │
│ 包含: *.ts,*.tsx      排除: node_modules,dist         [ 搜索 ]     │
│ 12 个文件 · 48 处匹配 · 0.42s                        [ 取消 ]     │
├───────────────────────────────────────────────────────────────────┤
│ ▾ src/client/store.js  (12)                                       │
│     123   const searchQuery = ...                                 │
│     456   ...                                                     │
│ ▸ src/client/ProjectPanel.jsx  (3)                                │
└───────────────────────────────────────────────────────────────────┘
```

- 结果按文件分组，文件节点可折叠；行号 + 命中片段，命中词高亮。
- `↑/↓` 在结果间移动，`Enter` 打开并定位到行；`Esc` 关闭搜索页。
- 单击结果 → 在编辑器中打开（遵循默认打开模式），滚动到行并闪烁高亮；双击 → 固定标签。
- 结果头部显示"文件数 / 匹配数 / 耗时"；搜索中显示进度与"取消"。
- 搜索范围：项目 / 选中目录 / 打开的文件；尊重 `.gitignore` 与排除目录（开关可见）。
- 结果上限（如 2000 条）后显示"仅显示前 N 条，继续缩小范围"。
- 搜索历史（最近 10 条）可选。

**Host 侧新增**

```
POST /ide-toolwindows/api/fs.search
{
  root, query, caseSensitive, wholeWord, regex,
  scope: { kind: 'project' | 'dir' | 'files', path?, paths? },
  include: string[], exclude: string[], maxResults
}
→ { files: [{ path, matches: [{ line, column, preview }] }], truncated, tookMs }
```

实现建议：

- 仓库内优先 `git grep -n -I --column --no-color`（按需 `-i`、`-w`、`-F/-E`；未跟踪文件用 `git ls-files -co --exclude-standard` 补一轮读取）。
- 非仓库或需要更细过滤时走自实现遍历：尊重 `.gitignore`/排除列表，跳过二进制、>2MB 文件、`node_modules`、`dist` 等，限制并发与总结果。
- 必须支持取消：请求带 `searchId`，客户端"取消"发 `fs.search.cancel`；或走已有 WebSocket 流式返回（与终端同一条通道，注意分帧）。
- 10k 文件、简单字符串的目标：首屏结果 < 500ms，全量 < 2s；取消 < 200ms。

### 3.5 快速打开与 Search Everywhere

- `Ctrl+Shift+N`（IDEA 习惯）打开"快速打开"：模糊匹配项目文件路径，结果显示文件名 + 相对路径；最近文件置顶；`Enter` 打开，`Ctrl+Enter` 固定在右/下分屏（分屏可延后，先只做固定标签）。
- `Ctrl+Shift+A` 打开命令面板：按标题/快捷键模糊匹配所有已注册动作；`Enter` 执行。
- 双击 `Shift`（400ms 内）打开 Search Everywhere：Files / Actions / Symbols（符号可先只做文本匹配）三个分段。
- 文件索引来源：启动时 `git ls-files -co --exclude-standard`（仓库）或一次树遍历（非仓库）；缓存到内存，`Ctrl+Alt+Y` 同步时失效重建；10k 文件建索引 < 300ms。
- 这一项与"动作注册表"绑定（见 7.5），否则会变成另一套不受快捷键体系约束的 UI。

### 3.6 树内过滤的修复（不要和全局查找混为一谈）

当前 `flatten()` 的过滤逻辑（`ProjectPanel.jsx:60-109`）只对 `state.dirs` 中已加载的目录生效：输入关键字时会把已加载目录视为展开，但**不会为子目录发 `loadDir`**，所以折叠/未加载的目录永远搜不到。

**实机确认（`14-tree-filter-loading.png`）**：在折叠的仓库里输入 `store.js`，树没有真正加载 `src/client`，而是给每个顶层目录显示"加载中..."，没有任何命中文件；这比"搜不到"更糟——用户会看到一堆永久加载态。

两个可选方向（建议 A+B 都做）：

- **A. 快速文件定位（推荐主入口）**：过滤框改成"输入即全项目文件名搜索"，结果以**扁平列表**呈现（文件名 + 相对路径 + 高亮），`Enter` 打开；`Esc` 清空并恢复树。数据源复用快速打开的文件索引。这符合"我要找文件"的真实意图。
- **B. 保留树内过滤**：查询时按需加载（BFS，限制并发与节点数），显示"搜索中…"和"已加载 N 个目录"；结果中高亮匹配片段；`Esc` 恢复过滤前的展开快照。若不做 B，就在输入框 placeholder 中明确写"仅过滤已展开的目录"，不要让用户以为搜了整个项目。

### 3.7 验收标准（SRCH）

- [ ] 只读打开任意文本文件，`Ctrl+F` 出现插件 FindBar；输入后计数正确；`Enter`/`Shift+Enter`/`F3` 循环；`Esc` 关闭；**全程不出现英文/黑块面板**。
- [ ] 只读代码区可以拖选、`Ctrl+A`、`Ctrl+C`，粘贴内容与选中一致；Diff 区同样可复制。
- [ ] 编辑态 `Ctrl+F` 使用同一 FindBar；替换/全部替换可用，操作后 dirty 状态正确。
- [ ] Markdown 预览、Diff、提交 Diff 均可查找并跳转。
- [ ] `Ctrl+Shift+F` 打开 Find in Files；按文件分组；结果数/耗时正确；点结果定位到行；取消能停止；10k 文件首屏 < 500ms。
- [ ] 树内输入文件名，能在**未展开**的目录中命中（或明确提供全项目快速定位）；有匹配高亮/计数/空态。
- [ ] `Ctrl+Shift+N` 快速打开 10k 文件仓库，输入 3 个字符后结果 < 50ms；`Enter` 打开正确文件。
- [ ] 所有搜索入口在无仓库工作区可用（遍历模式），不抛 500。

### 3.8 待拍板

- Find in Files 放编辑器标签页还是底部面板（推荐标签页：空间大、可保留、可多开）。
- 快速打开用 `Ctrl+Shift+N` 还是 `Ctrl+P`（推荐两者都支持，可重绑）。
- 树过滤是升级为全项目快速定位，还是保留"仅过滤已展开"并明确提示（推荐 A+B）。

---

## 4. 必改问题二：Git 历史与详情（P0-2）

### 4.1 现状与 PRD 矛盾

当前实现（图 1 下半部分）：

```
┌ Git ─────────────────────────────────────────────┐
│ [分支切换▾] [分支过滤▾] [作者] [搜索] [刷新]      │
│ ┌ 日志（约 58% 高） ───────────────────────────┐ │
│ │ ...                                          │ │
│ └──────────────────────────────────────────────┘ │
│ ┌ 提交详情（max 42%，独立滚动） ───────────────┐ │
│ │ subject / meta / 文件列表 / 总 +/-           │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

问题不在"有没有详情"，而在**详情和日志争夺同一个垂直空间**：

- 本机底部 dock 已拉到约 480px，单击一条提交后日志仍只剩约 5 行，详情被窗口底部截断（实机 `04-git-single-click.png`）；默认 270px 只会更差。
- 详情区自己有滚动条，日志区也有滚动条；用户在两个很矮的窗口里各滚各的。
- 没有可拖分隔条、没有折叠、没有"详情全屏"。
- 单击提交立刻拉详情（实机：`2ede1a6` 单击即出详情），双击又打开一个重复的提交 diff 标签（实机：`52216f9` 打开巨型 diff）；双击会触发两次 click + 一次 dblclick，实际发出 2-3 次 `git.detail` 请求。
- 筛选变化后 `selectedHash/detail` 不清空，详情可能显示一条已不在列表里的提交。
- 顶部 `main` branch chip 看起来像入口，实机点击**无任何反应**。

PRD-v2 自身也矛盾：

- §6.1 写"日志表与详情面板上下分栏"；
- §6.3 写"**单击**选中该 commit，**双击**打开其 diff""**单击**在详情面板内联 diff 预览"。
- 实现者按 §6.1 做了上下分栏，又按 §6.3 的"单击"做了立即拉详情，于是得到"单击就挤压日志 + 双击再开重复标签"的混合体。

**V3 必须以本文档为准，修订 PRD §6.1/§6.3。**

### 4.2 目标布局：日志在左，详情从右侧以 Drawer 出现

```
┌ Git ──────────────────────────────────────────────────────────────────────┐
│ [分支: 当前分支 main ▾] [作者 ▾] [搜索……] [日期 ▾] [路径 chip] … [刷新]   │
│ ┌ 日志（占满剩余高度） ────────────────────────┐ ┌ 提交详情（Drawer） ──┐ │
│ │ ◇ │ SHA │ 消息 │ 作者 │ 日期                 │ │ abc1234  [复制] [×]  │ │
│ │ ● │ ... │ ...  │ ...  │ ...                  │ │ 作者 / 邮箱 / 头像   │ │
│ │ ...                                          │ │ 作者时间 / 提交时间  │ │
│ │                                              │ │ refs / parents       │ │
│ │                                              │ │ 完整消息             │ │
│ │                                              │ │ 变更文件（状态/+/-） │ │
│ │                                              │ │ [文件内联 diff 预览] │ │
│ │                                              │ │ [动作按钮]           │ │
│ └──────────────────────────────────────────────┘ └──────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

**形态**

- 宽屏（可用宽度 ≥ 760px）：**右侧分栏 Drawer**，默认宽 420px，可拖拽（340–60%），宽度按工作区持久化；日志保持全高、全宽减 Drawer。
- 窄屏（< 760px）：Drawer 变为**覆盖式抽屉**（右侧 100% 宽，带半透明遮罩），`Esc`/遮罩/`×` 关闭；关闭后日志恢复全宽。
- 打开/关闭动画 160–180ms，`prefers-reduced-motion` 时取消动画。
- Drawer 非模态：日志仍可点（宽屏时），这样"看下一条"不用先关闭。
- 焦点管理：打开时焦点进入 Drawer 头部；关闭时焦点回到触发的提交行，便于键盘连续浏览。

**点击模型（对齐文件树）**

| 操作 | 行为 |
|---|---|
| 单击提交 | 仅选中（整行高亮），**不发请求、不改变 Drawer** |
| 双击提交 / `Enter` | 打开该提交 Drawer（若已开则切换内容） |
| Drawer 内双击文件 | 在编辑区打开该文件的完整 diff 标签 |
| Drawer 内单击文件 | 选中文件并在 Drawer 内联展开该文件的 diff（不新建标签） |
| `Esc` | 关闭 Drawer（焦点回日志） |
| `↑/↓` | 移动选中行并滚动到视口 |
| `Ctrl+click` | 加入 Compare（最多 2 个），状态栏/工具栏出现 compare chip |
| `Ctrl+D` | 对已选两个提交执行 Compare |
| 右键 | 菜单：Open Details / Compare with HEAD / Copy SHA / Checkout / Revert / … |

### 4.3 Drawer 内容规格

头图：

```
abc1234  [复制完整 SHA] [复制短 SHA]  [×]
feat: V2 JetBrains pass (0.3.0)
LiangshouX <xiaoliangshou.bit@gmail.com>   2026-10-22 14:44 +0800
committed 2026-10-22 14:44 +0800
refs: HEAD -> main, origin/main        parents: 9a20e5b  85204d3
```

| 区块 | 内容 | 交互 |
|---|---|---|
| 元信息 | 作者、邮箱、头像色块、author date、**committer date**、refs chips、parents | 点 parent 在 Drawer 内打开父提交；点 refs 可复制/过滤 |
| 消息 | subject + body（保留换行、可选中复制） | `Copy message` |
| 统计 | `N files, +A −D` | 无 |
| 文件列表 | 状态图标/字母（A/M/D/R/C）、路径（文件名 + 目录灰字）、**单文件 +N −M** | 单击选中并展开内联 diff；双击打开完整 diff 标签；右键 Copy path / Open at revision |
| 内联 diff | 该文件的迷你 DiffView（只读，可折叠上下文） | 打开完整 diff；复制 |
| 动作 | Show Diff with Parent（默认）/ with Working Tree / Open Full Diff / Revert / Cherry-pick / Checkout / Create Branch / Create Tag | 全部二次确认；V3 可只做前三个 + Revert，其余按范围表 |

**Host 数据模型要改**

当前 `git.detail` 返回整段 `diff` 文本，前端用正则从 `diff --git` 里抠文件名（`GitPanel.jsx:111`），并且为了显示元信息把整个提交的 diff 都拉下来。大提交（几百个文件）会明显卡顿，重命名/带空格/带引号的路径还可能解析错。

建议：

```json
{
  "hash": "...", "shortHash": "...", "parents": ["..."],
  "author": "...", "email": "...", "authorDate": "...", "committerDate": "...",
  "refs": ["..."], "subject": "...", "body": "...",
  "stats": { "files": 12, "additions": 340, "deletions": 22 },
  "files": [
    { "path": "src/a.ts", "oldPath": null, "status": "M",
      "additions": 12, "deletions": 3, "binary": false }
  ]
}
```

- 元信息用 `git show -s --format=...`。
- 文件列表用 `git show --numstat -z --name-status -z --format=` 或 `git diff-tree -r --numstat -z`；不要解析 diff 文本。
- 单文件 diff 懒加载：Drawer 内点开文件时调 `git.commit-file-diff`；完整提交 diff 在打开标签时再构建，或按文件分页。
- 合并提交：返回 `parents` 与"默认对比 first parent"；Drawer 顶部提供 `vs parent 1 / parent 2` 切换（P1）。
- 详情缓存：客户端 `Map<hash, detail>`，LRU 50；同一提交二次打开不重新请求。

### 4.4 筛选器重做

**目标**：一行可读的筛选工具条；每个控件有标签/图标、可清除；任何筛选都不产生写操作。

```
[分支: 当前分支 main ▾] [作者: 全部 ▾] [搜索消息/哈希……] [日期: 全部 ▾] [路径: src/… ×]  [清除] [刷新]
```

- 默认范围：**当前分支**（PRD §6.2 的原意），而不是现在的 `--all`。
- 分支下拉只做筛选：选项 = `当前分支 (main)` / `所有分支` / 各本地分支 / 各远程分支；不执行 checkout。
- 作者：从 `git shortlog -sne` 取列表的多选下拉（带搜索），而不是自由文本输入（现在输入 350ms 防抖，体验像盲猜）。
- 搜索：默认**固定字符串**（`--fixed-strings`），提供 `.*` 正则开关；当前直接用 `--grep=<用户输入>`，输入 `[` 会让 git 直接 `exit 128: Invalid regular expression`（附录 B.4）。
- 哈希：用户输入 7–40 位十六进制时，显示一行"跳转到提交 <hash>"，或在结果顶部固定该提交；不要静默返回 0 条（当前 `--grep=7eb0373` 必然 0 条）。
- 日期：今天 / 最近 7 天 / 最近 30 天 / 自定义（`--since/--until`）。
- 路径：来自 Project 右键 `Git | Show History` 的 chip，可 × 清除；再点一次可"在路径中搜索"。
- 结构性改动：如果 V3 不做 `--numstat -w --ignore-blank-lines`，就**从 UI 和 PRD 删掉这个开关**，不要留一个假开关。
- 过滤变化时：清空 `selectedHash` 与 Drawer（或显示"当前提交不在结果中"），重置分页，显示加载态；保留滚动位置到顶部。
- 结果为空：显示"没有匹配的提交" + "清除筛选"按钮；错误显示可重试，不要只在行数为 0 时才显示错误。

### 4.5 提交标签页（双击的另一种去向）

当前双击打开 `commit:<hash>` 标签：一个巨大的只读 DiffView，所有文件从头铺到尾，没有文件导航、没有粘性文件头、没有跳转源码。对于 30 个文件的提交，用户只能长滚动。

建议把它升级为 **Commit 详情视图**（可复用 Drawer 内容）：

- 左：文件列表（状态、`+/-`、筛选框）；右：选中文件的完整 diff（粘性文件头 + F7/Shift+F7 下一个/上一个改动）。
- 顶部：hash/subject/parents/refs + "Open in Git window"。
- 支持查找（复用 FindBar）。
- 如果本轮时间不够，至少给现有 DiffView 增加：粘性文件头、文件下拉跳转、"Jump to Source"、F7/Shift+F7。

### 4.6 性能与细节

- 分页：当前 `skip` 分页在 `--all` + 新提交到达时可能重叠/漏项；记录上一页最后一条的 hash 作为游标（`--max-count` + `--skip` 仍可用，但过滤变化必须重置）。
- 图：`GRAPH_MAX = 8`，超过 8 条 lane 时颜色会复用、列被截断；refs 只显示前 2 个（`slice(0, 2)`），其余静默隐藏。至少加 `+N` 溢出提示。
- 颜色：`GRAPH_COLORS` 是固定 8 色，不随主题；浅色主题下可读性需验证。
- 行高 24px、作者/日期在窄宽隐藏（已有），但 Drawer 窄屏时也要保持日志可用。
- 搜索输入去掉 350ms"无 loading"的盲等：显示 spinner 或结果计数变化；增加"清除"按钮。
- `git.status` 刷新后如果当前 Drawer 的提交还在，保持；如果 HEAD 变化（checkout/commit），刷新 Drawer 的 refs 或关闭并提示。

### 4.7 验收标准（GIT）

- [ ] 底部 Git 窗 270px 高时，日志至少 5 行可见；打开 Drawer 后日志不被压扁；Drawer 可拖宽并持久化。
- [ ] 单击提交只换选中行，不发 `git.detail`；双击/Enter 才打开 Drawer；`Esc` 关闭且焦点回到原行。
- [ ] Drawer 显示完整元信息（含 committer date）、refs、parents；父提交可点击跳转；复制完整/短 SHA 正确。
- [ ] 文件列表有状态字母/颜色与单文件 `+N −M`；单击内联 diff < 300ms；双击打开完整 diff。
- [ ] 筛选：分支/作者/日期/路径/关键字与 CLI 基线一致；输入 `[` 不报错；输入 hash 能跳转；默认只看当前分支。
- [ ] 分支筛选不会改变 HEAD；切换分支必须走分支弹层 + 确认。
- [ ] 双击大提交不再在标签页里铺一个无导航的巨 diff（或至少有文件导航/粘性头）。
- [ ] 200 条日志首屏 < 1s；Drawer 打开 < 300ms（缓存后 < 50ms）；大提交元信息不拉全量 diff。

---

## 5. 必改问题三：文件树高亮语义（P0-3）

### 5.1 现状

图 2 标注 1 和 2：

- `dsh.plugin.json` 是**打开的标签页**，被整行蓝色高亮；
- `package-lock.json` 是**单击选中的文件**，也被整行蓝色高亮。

实现原因（`ProjectPanel.jsx:504-508`）：

```jsx
const active = state.tabs.find(tab => tab.kind === 'file' && tab.path === entry.path && tab.id === state.activeId)
...
className: `${classes} ${active !== undefined ? 'itw-selected' : ''}`
```

"当前标签页"和"选中项"复用了同一个类 `itw-selected`（`styles.js:302`）。当两者不是同一个文件时，用户看到两行一样蓝，无法判断"我点的是哪个/编辑器里是哪个"。

**实机确认（`01-two-highlights.png`）**：新开 `package.json`（当前标签）后单击 `package-lock.json`，两行同时蓝；再单击 `LICENSE`，`package.json` 仍保持蓝色。也就是说，用户在树上无法区分"打开的"与"选中的"；`LICENSE` 的选中底色甚至比 `package.json` 的打开底色更浅，视觉层级与操作意图相反。

Commit 文件列表也有同类缺口：它只有"选中"一种状态（`CommitPanel.jsx:33`），没有"该文件的 Change View 已打开"的标记；CSS 里定义了 `.itw-file-row.itw-active`（`styles.js:402`），但没有任何组件使用它——这正是"状态模型没有落地"的证据。

### 5.2 状态模型（四个正交状态）

| 状态 | 触发 | 视觉 | 说明 |
|---|---|---|---|
| **打开的文件（Open）** | 该路径存在标签页且是当前激活标签 | 文件名 **semibold**；可选右上角 4px 圆点/小图标 | 不占整行背景；JetBrains 用粗体表示"已打开" |
| **选中（Selected，树有焦点）** | 单击/Ctrl/Shift 选择 | 整行 `--itw-selection` 背景 | 这是"我要对谁操作" |
| **选中（树无焦点）** | 焦点在编辑器/菜单 | 整行 `--itw-selection-inactive` 灰蓝 | 保留选中，但弱化，避免和激活文件抢 |
| **键盘焦点（Focus）** | 键盘导航/按 Tab 进入树 | 1px 内描边 `--itw-selection-outline` | 只在树有焦点时出现 |

**叠加规则**

- Open + Selected：蓝底 + semibold。
- Open 但未选中：只有 semibold（没有蓝底）。
- Selected 但未打开：只有蓝底。
- 多选：所有选中行同色；anchor 行加 1px 描边。
- 文件状态色（红/绿/蓝/棕）继续作用于文字色；选中时文字仍保持状态色（或统一为高对比前景，二选一并写进规范）。
- 失焦状态必须可区分：`inactive` 背景透明度约为 active 的 50%。

### 5.3 视觉令牌（新增）

```css
:root {
  --itw-selection:          rgba(76, 154, 255, .28);
  --itw-selection-inactive: rgba(127, 127, 127, .16);
  --itw-selection-outline:  rgba(76, 154, 255, .55);
  --itw-open-file:          var(--itw-fg);
}
```

- 所有树/列表禁止再写死 `rgba(76,154,255,.18)` 这类数值；统一走令牌，亮/暗主题各自覆盖。
- 行高内边距保持 22px；semibold 不能导致行高变化。

### 5.4 行为规则

- `alwaysSelectOpened` 设置目前是**死的**：`activateTab()` 无条件 `setSelectedPath`（`store.js:1049-1054`），设置项只出现在 UI。要么实现，要么删除。
  - 开启：切换标签 → 树自动展开并选中该文件（当前行为）。
  - 关闭：切换标签只改"打开的文件"（粗体），不改变用户当前选中项；提供"Reveal active file"按钮手动定位。
- 当树失去焦点（点击编辑器/工具栏），选中行切到 inactive；点击树内空白/行时恢复 active 并获得键盘焦点。
- 单击未选中行 → 选中它（不打开）；双击 → 打开。与现有行为一致，只改视觉。
- 关闭标签后，若该文件原本是 Open 状态，粗体消失；选中状态保持不变（除非用户关闭的是选中项，按需重置）。
- 目录不参与 Open 状态；但"包含当前打开文件"的目录可以在展开状态上做轻微提示（可选，不做也不影响）。

### 5.5 验收标准（TREE）

- [ ] 打开 A，再单击 B：只有 B 有蓝底；A 只有粗体，不再出现两行同色。
- [ ] 点击编辑器使树失焦：B 的蓝底变为灰蓝；A 仍为粗体。
- [ ] Ctrl+click 多选：所有选中行蓝底；anchor 有描边；激活文件仍只有粗体。
- [ ] 关闭 A 的标签：A 的粗体消失；B 的选中状态不变。
- [ ] Commit 文件列表：选中行 vs 已打开 Change View 的行可区分（同一套模型）。
- [ ] 打开"Always Select Opened File"关闭后，切换标签不改变树选中；打开时自动展开并选中。
- [ ] 亮色/暗色主题下三种背景对比度均 ≥ 3:1，文字可读。

---

## 6. 必改问题四：分支筛选控件重复且危险（P0-4）

### 6.1 现状

图 2 标注 3：Git 筛选行里并排两个几乎一样的分支下拉。

- 第一个（`GitPanel.jsx:220-233`）：`value = state.status.branch`，`title = "切换分支"`，`onChange = store.checkout(ref)`。
- 第二个（`GitPanel.jsx:249-256`）：`value = git.filters.branch`，`title = "分支"`，`onChange = setGitFilters({ branch })`。

两者视觉上都是"一个显示分支名的下拉"，但一个是**写操作（checkout）**，一个是**读操作（过滤）**。用户无法从外观区分；误操作第一个下拉会直接切分支，没有确认、没有脏工作区检查、失败只弹 toast（而且标题误用"提交失败"，见 UX-03）。

**实机确认**：Git 筛选行确实并排两个 `main` 下拉；顶部 `main` branch chip 点击无任何反应；为避免影响工作区，本次**没有实际切换分支**，checkout 行为由源码确认。

根因同样是 PRD 缺口：§6.2 只定义了"分支过滤"，§6.5 提到"切分支/检出标签"但没有规定入口，实现者把"当前分支"做成了一个下拉，顺手把切换塞进了筛选行。

### 6.2 设计原则（写进 PRD）

> **筛选控件不得产生写操作。**
> 任何会改变仓库状态的动作（checkout、revert、delete、discard）必须是动词按钮/菜单项，必须二次确认，必须在执行前检查工作区是否干净。

### 6.3 目标：一个筛选 + 一个分支弹层

**筛选行只保留一个分支控件：**

```
[分支: 当前分支 main ▾]   ← 纯筛选，选项：当前分支 / 所有分支 / main / feature/x / origin/main
```

- 选项前用图标区分本地/远程；当前分支打 ✓。
- 选择后只重载日志，不执行 checkout。
- 有"所有分支"选项，默认"当前分支"。
- 控件旁有清除（恢复默认）和 tooltip："仅筛选历史，不切换分支"。

**切换分支移到顶部 Branch 弹层：**

- 顶部 `itw-branch-chip` 现在是不可点击的 `<span>`（`Workbench.jsx:40-51`；**实机点击无任何反应**），改为按钮：点击打开分支弹层。
- 弹层内容：
  - 搜索框；
  - 本地分支列表（当前 ✓；显示 ahead/behind；点击 = 检出）；
  - 远程分支列表（`origin/*`；点击 = "Checkout as local branch…"）；
  - `New Branch from current…`、`Fetch`（按 V3 范围裁剪）；
  - 底部 "Manage branches…"（可选）。
- 检出流程：
  1. 若工作区有未提交改动 → 阻止并提示"有 N 个未提交改动，请先提交/收起"（或提供"打开 Commit"），不要直接 checkout。
  2. 二次确认：`main → feature/x`，说明 HEAD 会移动；detached 检出要明示。
  3. 成功后刷新四窗；失败显示完整 stderr（不要用"提交失败"标题）。
- 键盘：输入即过滤；`↑/↓` 选择；`Enter` 检出；`Esc` 关闭。

**如果产品坚持在 Git 工具窗里也能切换分支**，则把它做成一个**带文字的按钮**：

```
[⇄ 检出分支…]  ← 打开同一个弹层，不在筛选行
```

不要再用第二个 `<select>`。

### 6.4 验收标准（GIT-BRANCH）

- [ ] Git 筛选行只有一个分支下拉；改变它不会改变 HEAD（`git rev-parse HEAD` 前后一致）。
- [ ] 顶部 branch chip 可点击，弹出分支列表；搜索/键盘可用。
- [ ] 从弹层检出分支：脏工作区被阻止并给出明确提示；干净时二次确认后成功，四窗刷新。
- [ ] 远程分支不能被误当成筛选或静默 detached；有明确"Checkout as local branch"路径。
- [ ] 检出失败时显示真实错误（不是"提交失败"），可复制 stderr。
- [ ] 文档/PRD 中"分支筛选"与"分支切换"分开描述。

---

## 7. 其他 P0：数据与信任

### 7.1 只读内容不可复制（EDIT-02）

**现象**：默认只读的代码、Diff、提交 Diff、Git 提交详情文本都无法拖选/`Ctrl+C`。**实机确认：只读代码拖选后剪贴板仍是 baseline；编辑态同一文件可复制出 70 字符；提交 diff 拖选无效，`Ctrl+C` 复制到的是此前 `Ctrl+A` 选中的 DSH 侧栏文本。** 也就是说：不是"所有文本都不能复制"，而是**默认只读态不能复制**，这恰好是最常用的状态。

**证据**：

- `.itw-root { user-select: none }`（`styles.js:53`）。
- `.itw-code`（`styles.js:194-214`）与 `.itw-diff-scroll`（`styles.js:420-436`）没有 `user-select: text`。
- 对比：Markdown 预览（`styles.js:221`）、错误框（336）、Commit 消息框（378）都显式设了 `user-select: text`；CodeMirror 编辑区有自己的选择实现，所以编辑态可以复制。
- 实机截图：`02-readonly-copy-blocked.png`（拖选后无选区）、`03-codemirror-search.png`（编辑态）。

**影响**：这是最高频的操作；无法复制等于无法把代码贴给 AI，直接摧毁插件在 DSH 场景下的核心价值。

**建议**：

```css
.itw-code, .itw-code-text,
.itw-diff-scroll, .itw-diff-text,
.itw-git-detail-body, .itw-git-detail-meta {
  user-select: text;
}
.itw-ln, .itw-diff-num, .itw-diff-gutter, .itw-diff-sign {
  user-select: none;   /* 行号/装订线不参与复制 */
}
```

- 增加 `Ctrl+A` 在代码区只选代码；**实机已复现 `Ctrl+A` 选中 DSH 侧栏文本**（见 E4），必须把选择作用域限制在代码/Diff 容器，不能让宿主侧栏被卷进来。
- 右键菜单增加 `Copy`（复制选中）与 `Copy Path`，但不要拦截浏览器原生复制。
- 验收：只读态拖选 3 行 → `Ctrl+C` → 粘贴内容完全一致；双击选词；Diff 可复制；`Ctrl+A` 不选择 DSH 侧栏。

### 7.2 终端随面板/工具窗切换销毁（TERM-01）

**现象**：

- 从工作台切回对话：`deactivate()` 清空 `terminal.sessions`（`store.js:494-503`），PTY 在 socket close 后被宿主终止（`index.js:489-492`）。
- 在底部从 Terminal 切到 Git：`TerminalPanel` 卸载，`TerminalView` cleanup 关闭 socket（`TerminalPanel.jsx:142-152`），宿主终止 PTY；切回来是新 shell。
- 连"关闭底部 dock 再打开"也可能触发同样的销毁/重建。

**实机确认**：

- 在 Terminal 里执行 `echo ITW_CHAT_TEST`（输出可见）→ 点 Git → 再点 Terminal：scrollback 被清空，只剩一个新的提示符；会话 tab 的绿点还在，但"历史"已经没了（`06-terminal-scrollback-lost.png`）。
- 在 Terminal 打开的状态下切到对话，再切回 IDE：底部终端面板直接关闭，会话计数清零（`07-terminal-closed-after-chat.png`）。
- 这与源码路径一致：`deactivate()` 清空 sessions，socket close 后宿主 terminate。

**影响**：DSH 的使用方式就是"写代码 ↔ 问 AI"；终端是最高频的长驻进程。切一下对话就杀掉 `npm run dev`/测试/REPL，这个插件无法常开。

**建议（推荐方案）**：

1. **Host 持有 PTY 会话注册表**：`sessionId`（持久 key）、PTY handle、cwd、shell、标题、创建时间、最后活跃时间、环形 scrollback（如 256KB）。
2. 客户端断开（组件卸载/切面板）不杀 PTY，进入"detached"状态；超过 30 分钟空闲（可配置）再回收。
3. 重新挂载时用 `sessionId` 重连：host 回放 scrollback（或只回放最近 1000 行），客户端 `terminal.reset()` 后写入；保持 cwd/标题/进程状态。
4. 只有用户点终端标签的 `×` 或关闭工作台（明确退出）才终止；应用退出时统一清理。
5. 底部 Terminal 与 Git 切换时**保持 TerminalPanel 挂载**（`display:none`），避免 xterm 实例销毁；这与 1/2 配合，体验最稳。
6. 会话徽标/状态：detached 显示灰点，running 显示绿点；点击恢复。
7. 若本轮不做完整重连，最低限度：切到 Git/对话时**不要杀进程**，回来时提示"会话已断开，是否重新连接"并提供 scrollback 副本。

**验收**：

- [ ] 启动一个持续输出命令（如 `ping -t` / `npm run dev`），切到对话 10s，再切回：进程仍在、输出连续、cwd 不变。
- [ ] Terminal ↔ Git 反复切换 5 次，会话不丢、scrollback 不丢。
- [ ] 点终端 `×` 才终止；关闭工作台/应用退出后无孤儿进程。
- [ ] 多会话（3 个）分别保留各自 scrollback 与状态。

### 7.3 未保存与外部修改（EDIT-03 / EDIT-04）

**现状**

- 关闭脏标签：只有"放弃修改 / 取消"（`store.js:1065-1086`），没有"保存并关闭"。
- `Close Others` 直接保留脏标签（`store.js:1088-1091`），不提示——用户以为已关闭。
- 没有 `beforeunload` 防护；页面刷新/宿主重载会丢草稿。
- 保存不校验外部修改：`fs.write` 直接覆盖；`#refreshActiveFile` 在编辑态直接 return（`store.js:568`），外部改动看不到，下次保存就覆盖。
- "还原"按钮（丢弃草稿）无确认（`EditorArea.jsx:329-332`，Tab 菜单 186-188）。

**建议**

- 关闭确认改成三按钮：**保存 / 放弃 / 取消**；批量关闭（Close Others/All/Right）逐个处理，支持"全部保存/全部放弃"。
- 监听 `beforeunload`（或 DSH 的等价钩子）：有脏标签时阻止并提示；至少 `Ctrl+S` 可保存全部脏标签（`Save All`）。
- 保存前比较 `mtimeMs/size`（host 返回的 mtime 与当前文件）；不一致 → 弹"文件已在磁盘上更改"：`重新加载 / 覆盖 / 查看差异`。
- 打开中的非活动标签也要检查外部修改（轮询打开标签的 mtime，或 `fs.watch`）。
- "还原"加二次确认；如果有未保存内容，提示"将丢弃 X 行修改"。
- 可选：自动保存（默认关）+ 崩溃恢复草稿（按工作区持久化）。

**验收**

- [ ] 修改文件 → 关闭标签 → 出现"保存/放弃/取消"；保存后磁盘内容正确、dirty 清除。
- [ ] Close Others 遇到脏标签会提示，不静默保留。
- [ ] 编辑中在外部修改文件 → 保存时出现冲突对话框；选择重新加载后编辑器显示新内容。
- [ ] 刷新页面/切工作区前有未保存提示（或自动恢复草稿）。

### 7.4 回滚不彻底 / 删除永久化（COMMIT-03 / UX-02）

**回滚（Rollback）**

`host/git.js:329-332` 只执行：

```js
git restore --worktree -- <paths>
```

真实 git 复现（附录 B.2）：

```
before:   M  f.txt        （已暂存）
after:    M  f.txt        （仍然已暂存，工作区回到暂存版本）
```

即"回滚"对已暂存/部分暂存文件**没有真正丢弃改动**，只是把工作区对齐到 index。用户以为回滚了，实际 index 还留着，下一次提交会带上。

**建议**：

- 已跟踪文件：`git restore --source=HEAD --staged --worktree -- <paths>`（同时清 index 和工作区）。
- 未跟踪文件：按设置移入回收站或明确永久删除；不要 `unlink().catch(() => {})` 静默失败（`index.js:269-271`）。
- 回滚前：列出将受影响文件与 `+/-`，二次确认；回滚后刷新 status、清空勾选、刷新打开中的 diff。
- 支持 Undo（至少保留上一版内容到本地历史/临时备份），或明确写"不可撤销"。

**删除**

`host/fileops.js:245-247`：

```js
if (trash) trashed = await trashViaPowerShell(source, info.isDirectory())
if (!trashed) await rm(source, { recursive: true, force: false })
```

回收站失败时**静默永久删除**；确认框文案（`project.delete*`）也没有说明是回收站还是永久删除。

**建议**：

- 确认框明确："将移入回收站（可在系统回收站恢复）"或"将永久删除"。
- 回收站失败 → 弹出第二次确认："回收站不可用，是否永久删除？"默认取消；不要静默降级。
- 删除结果 toast 区分"已移入回收站/已永久删除/失败"。
- 批量删除失败逐项报告，不要只报总数。

**验收**

- [ ] 对"已暂存但工作区无改动"的文件执行回滚：`git status` 变干净，文件内容回到 HEAD。
- [ ] 未跟踪文件回滚/删除：按设置进回收站；回收站失败时有第二次确认。
- [ ] 回滚/删除确认框列出文件名与数量；操作后四个窗口同步。
- [ ] 删除失败不再静默；错误可复制。

### 7.5 快捷键：死项、Ctrl+A 泄漏、全局抢占（KEY-01/02/03）

**A. 实机修正：树焦点可用，但 `Ctrl+A` 会泄漏到 DSH 侧栏**

2026-10-22 实机走查推翻了此前基于通用 Chromium 的推断：

- 点击 `package.json` 行后按 `F2`，**确实进入内联重命名**（`11-f2-works.png`）；按 `ArrowDown`，选中从 `LICENSE` 移到 `package-lock.json`。说明树容器在 DSH Desktop 中能获得焦点，**F2/方向键不是 P0**。
- 但 `Ctrl+A` 仍未实现：树内按 `Ctrl+A`，没有全选节点，反而选中了 DSH 侧栏的"新会话 / 插件 / 自动化任务 / 上下文洞察 / IDE 工具窗口"文本（`08-ctrl-a-leak.png`）；随后 `Ctrl+C` 会把侧栏文本复制走，污染剪贴板。这是一个真实的**跨宿主选择泄漏**（KEY-03）。
- 右键菜单打开后仍无方向键/Enter 支持（代码无实现，未逐项实测）。
- `F5`/`F11` 等保留键本次**没有实机按**（F5 会改文件，F11 会影响窗口）；不要在没有 `preventDefault` 的情况下宣传它们。

**建议**：

- 不必再给树加 `onMouseDown` 聚焦（已能聚焦）；改为把 `Ctrl+A` 加到树/代码作用域，并阻止事件冒泡到 DSH。
- 快捷键处理统一走 Action Registry（见 B），在注册表里标注 `scope: tree | editor | global`；`Ctrl+A` 在 tree scope 内只选可见节点。
- 增加回归测试：点击第 3 行 → F2/方向键生效；`Ctrl+A` 只选中树节点，不选中侧栏。
- `F5`、`Ctrl+D`、`F11`、`Ctrl+Shift+F12` 等保留键：在 webview 里统一 `preventDefault`，并在设置里列出冲突风险。**（实机未验证 F5 的宿主行为，先不要把它写成"确定会刷新"。）**

**B. 菜单/设置里承诺了但没实现的快捷键**

| 快捷键 | 出现位置 | 实现状态 |
|---|---|---|
| `Ctrl+D` 比较 | settings / PRD | 无处理函数（树、Git、全局都没有） |
| `Ctrl+Shift+F` 在文件中查找 | settings / Project fallback | 无；**实机按下无反应** |
| `Alt+F7` Find Usages | PRD | 无 |
| `Shift+F6` 重命名并更新引用 | settings / PRD | 无 |
| `F4` Jump to Source | Commit 菜单、编辑器工具栏 | 无键盘处理 |
| `Ctrl+Alt+Z` Revert Commit | settings / PRD | 无 |
| `Ctrl+Shift+A` Search Everywhere | settings / PRD | 无 |
| `Alt+↓` 提交消息历史 | PRD | 无 |
| `Ctrl+F4` 关闭标签 | PRD | 无 |
| `F7/Shift+F7` 下一个/上一个改动 | PRD | 无 |
| `Ctrl+A` 树全选 | PRD | 无；**实机选中了 DSH 侧栏文本**（KEY-03） |
| `Ctrl+Shift+T` 重开标签 | 常见 IDE | 无 |

README 还写着"所有快捷键均可在设置中重新绑定"（`README_ZH.md:27`），但设置页只暴露 6 个（`SettingsPanel.jsx:9-16`）。

**建议：引入动作注册表（Action Registry）**

- 每个动作：`id / title / category / defaultShortcut / context / enabled() / run()`。
- 右键菜单、工具栏、快捷键、命令面板、设置页都从同一注册表生成。
- 菜单显示快捷键时从注册表取；不允许写死字符串（PRD §8.1 本来就要求）。
- 设置页自动列出所有可重绑动作，带冲突检测（同一 context 下重复 → 红字）。
- 验收：菜单里出现的每个快捷键，都有对应 handler；做不到的菜单项直接隐藏（遵循"缺失即隐藏"）。

**C. 全局抢占焦点**

`index.jsx:130-165` 在 `document` 捕获阶段处理快捷键，且不判断焦点：

- 在 DSH 聊天输入框按 `F11` → 插件拦截并全屏工作台（`requestFullscreen`），聊天没进入浏览器全屏。
- 在聊天框按 `Ctrl+K` → 打开 Commit 并聚焦消息框（`inTerminal` 只排除了终端，不排除其他输入框）。
- 在任意输入框按 `Alt+1`/`Alt+0`/`Alt+9`/`Alt+F12` → 切走面板。
- 工作台不在活动面板时，`runShortcut` 仍会 `selectPanel`。

**建议**：

- 区分"面板激活键"（Alt+1/0/9/F12，可以全局）与"编辑/破坏性快捷键"（F2/F5/Delete 需树聚焦；F11/Ctrl+K 需工作台聚焦或目标非输入框）。
- `isEditableTarget(event.target)` 对编辑类快捷键直接 return。
- `F11` 只在工作台聚焦时接管；否则让宿主处理。
- `Ctrl+K` 在聊天输入框内不接管。
- 在设置里加"快捷键作用域"说明。

### 7.6 确认框误确认（UX-01）

`ConfirmModal`（`ui.jsx:116-133`）把 `autoFocus` 放在**确认按钮**上，且不处理 `Esc`。用户打开删除/回滚/丢弃确认后，按 Enter（或习惯性确认）就直接执行破坏性操作。

**建议**：

- 默认焦点放在"取消"；破坏性按钮不自动聚焦。
- `Esc` = 取消；点击遮罩 = 取消。
- 确认文案列出影响（文件名、数量、是否进回收站）。
- 对高危操作（删除项目、永久删除、回滚）增加"我已知晓"或输入确认（可选）。

**验收**：打开回滚确认，按 Enter 不执行；按 Esc 关闭；Tab 顺序合理；焦点不逃出模态。

---

## 8. P1：高频体验增强

> P1 = 明显低于竞品、影响效率或一致性，但不至于让用户立刻放弃。建议在 V3.0/V3.1 内完成。

### 8.1 编辑器与打开模式（EDIT-01/05/06/07/08/09）

| ID | 问题 | 建议 |
|---|---|---|
| EDIT-01 | 所有文本默认只读，打开后要额外点"编辑"；与 IDE 心智相反 | 默认改为**可编辑**（文本 ≤ 1MB）；超大/二进制才只读；保留设置可切回"预览优先"。如果坚持只读，至少：锁图标 + 双击正文进入编辑 + `Ctrl+F` 永远可用 |
| EDIT-05 | 标签只有 Close / Close Others；无 Close All / Right、无重开、无拖拽排序、溢出只能横向滚（滚动条隐藏） | 补全菜单与快捷键：`Ctrl+F4` 关闭、`Ctrl+Shift+T` 重开（10 层）、Close All/Right、标签拖拽排序、溢出 `⌄` 下拉；脏标签批量确认 |
| EDIT-06 | Diff 无查找、无文件跳转、无 F7、无"跳到源码"；只读提交 diff 是一整条长列表 | 复用 FindBar；文件头 sticky；文件下拉；F7/Shift+F7；F4 Jump to Source；折叠/展开全部 |
| EDIT-07 | 面包屑只是文本，不可点击；无 `Ctrl+G` 行跳转；无"在项目中定位" | 面包屑每段可点击（跳到目录/打开父级）；`Ctrl+G` 跳行；标签右键 "Reveal in Project" |
| EDIT-08 | 大文件截断后不能编辑、无"仍然打开"；二进制只有一句提示 | 截断时提供"以只读完整加载/仍然编辑"（带警告）；二进制显示类型/大小/十六进制入口（P2） |
| EDIT-09 | 编码显示两套（工具栏 `utf-8`，状态栏 `UTF-8 LF`），且不可点 | 统一显示与来源弹层；提供"用其他编码重新打开/另存"（P1 可先只读展示） |

补充：

- `CodeEditor` 的 `THEME` 固定 `dark: true`（`CodeEditor.jsx:97`），语法色也是写死的浅色主题色；在 DSH 浅色皮肤下会出现"背景亮、代码色按暗色设计"的错配。改成跟随主题的两套 token（见 8.7）。
- 语法高亮是自制 tokenizer（`CodeView.jsx`），不支持 JSX/TS 泛型/模板字符串嵌套等；作为只读预览可接受，但默认只读会放大这个缺陷。若默认改为可编辑 CodeMirror，此问题自然弱化。

### 8.2 Commit 工具窗（COMMIT-01/02/04…09）

| ID | 问题 | 建议 |
|---|---|---|
| COMMIT-01 | **实机**：300px 宽内核心控件实际放得下，不是"挤爆"；但 `提交并推送` 是消息框下方的小字链接，可发现性差；分组不可折叠、未跟踪行无状态色、Changelist/回滚挤在同一行 | 把 `Commit and Push` 做成明确按钮或 `⋯` 菜单项；分组可折叠；未跟踪/修改行加状态色；Changelist 收进工具栏 |
| COMMIT-02 | 勾选先改 UI 再 `git add`，失败不回滚 → 复选框与 index 不一致 | 勾选时进入 pending；成功才落状态；失败回滚复选框并 toast；或先请求后乐观更新（带 loading） |
| COMMIT-04 | Changelist 的"当前列表"只改标题，不过滤列表；`moveToChangelist` 还会把 active 切到目标；无重命名/删除/清理 | 实现 active 过滤 + "Show All"；补重命名/删除；删除/重命名文件后清理列表；或本轮先移除整个 Changelist UI，避免假功能 |
| COMMIT-05 | 冲突文件 checkbox 禁用，但没有"解决冲突"入口 | 冲突行显示"解决…"：打开文件、保存后 `git add`；Commit 头部显示冲突数 |
| COMMIT-06 | 分组不可折叠、无文件过滤、无全选/全不选文字、无键盘导航、行无状态色 | 组头加折叠箭头；组内搜索；`Ctrl+A`/空格勾选；上下键移动；状态字母加颜色与 tooltip |
| COMMIT-07 | 首次 push 无 upstream 直接失败；无 publish 分支流程；push 结果只有 toast | 检测无 upstream → 弹"发布分支到 origin/<name>"；显示 ahead/behind；失败保留错误并给"重试/Copy"；commit+push 两阶段结果分别持久显示 |
| COMMIT-08 | 消息历史只有下拉，无 `Alt+↓`；草稿不持久化；Amend 无风险提示 | 补 `Alt+↓`；按工作区保存草稿；Amend 勾选时提示"将改写上一条提交" |
| COMMIT-09 | 回滚按钮用"当前选中文件，否则勾选文件"的隐式规则 | 明确"回滚选中/回滚勾选"两种动作；确认框列出清单 |

### 8.3 Git 其余（GIT-04/05/06/08/09/10）

| ID | 问题 | 建议 |
|---|---|---|
| GIT-04 | 搜索是裸正则、无固定字符串、hash 搜不到；日期/结构性过滤缺失；作者自由文本 | 见 4.4；补日期、作者多选、固定字符串、hash 跳转；删掉未实现的开关 |
| GIT-05 | 详情由整段 diff 正则抠文件名，无单文件状态/统计，无父提交/复制/动作 | 见 4.3；host 返回结构化 `files[]`；详情缓存 |
| GIT-06 | 提交标签页是巨型无导航 diff | 见 4.5；至少 sticky 文件头 + 文件跳转 + 查找 |
| GIT-08 | 图谱最多 8 lane、refs 只显 2 个、compare 只能 Ctrl+click、无键盘 | lane 溢出显示 `+N`；refs `+N` 悬浮；compare 增加右键/键盘入口；行焦点与 `Enter` |
| GIT-09 | 默认 `--all` 混合所有分支；顶部 branch chip 不可点（**实机确认点击无反应**） | 默认当前分支；branch chip 改为弹层入口（见 6.3） |
| GIT-10 | 面板切换（Git↔Terminal）会重挂 GitPanel，日志滚动/选中详情重新加载 | 保持面板挂载或用 CSS 隐藏；保存滚动位置；避免每次打开都 `loadLog(true)` |

### 8.4 文件树操作（TREE-03…09）

| ID | 问题 | 建议 |
|---|---|---|
| TREE-03 | 头部 `+` 永远在项目根新建（`ProjectPanel.jsx:580-583`），忽略当前选中的目录；New File/New Directory 都显示 `Alt+Insert`，但快捷键只建文件（**实机右键菜单确认**） | `+` 以"选中目录/选中文件的父目录"为目标，tooltip 显示目标；`Alt+Insert` 打开 New 弹层（File/Directory），或 Directory 用 `Ctrl+Alt+Insert` |
| TREE-04 | F6 移动是"输入绝对路径"的文本框；冲突策略固定为自动改名，无 Overwrite/Skip/Keep Both | 目录选择器（树/搜索/最近）；冲突三选一 + "全部应用"；移动前预览 |
| TREE-05 | 拖拽不会自动展开悬停目录；只阻止拖到自身，不阻止拖进子树（host 会拒但体验差）；无复制/移动光标提示 | 悬停 500ms 展开；`isInside` 客户端预检 + no-drop；拖动时显示"移动 N 项/复制 N 项" |
| TREE-06 | "Always Select Opened File" 是死设置 | 实现或删除（见 5.4） |
| TREE-07 | 无 `Ctrl+A` 全选（**实机：按下后选中了 DSH 侧栏文本，KEY-03**）、无 type-to-select、无 Collapse All 按钮、无 Reveal Active File | 补全；`Ctrl+A` 只选可见行且阻止冒泡到宿主；输入字母跳转；头部加"定位当前文件"按钮 |
| TREE-08 | 隐藏文件开关切换后不立即生效（需要手动刷新）；显示隐藏/忽略/排除的视觉区分弱 | 切换后重载树；忽略=灰褐、排除=黄褐背景、隐藏=正常但可过滤；设置里可编辑排除目录列表 |
| TREE-09 | 重命名输入框不选中主文件名；非法字符/重名要到提交后才报错 | 默认选中不含扩展名的主干；输入时内联校验；Enter 提交/Esc 取消/失焦提交保持一致 |

### 8.5 设置与 i18n（SET-01..05 / I18N-01/02）

| ID | 问题 | 建议 |
|---|---|---|
| SET-01 | `alwaysSelectOpened`、`git.colors`、`wordWrap`、`diffStyle`、`logPageSize`、`structuralOnly` 等字段无实现/无入口 | 每个设置项要么实现，要么删除；不允许"开关拨了没反应" |
| SET-02 | **实机**：设置弹窗"终端"分组里确实有"字号 13"，但它写 `editor.fontSize`；终端字体读 `terminal.fontSize`，永远改不到 | 拆成"编辑器字体大小"与"终端字体大小"；分别绑定 |
| SET-03 | 快捷键捕获共用一个 `capturing` 布尔：点第二个时第一个仍在监听，两个动作会被同一按键同时改绑；无冲突检测；tooltip 英文 | 每个字段独立 armed；捕获时暂停其他监听；同 context 冲突红字；全部文案 i18n |
| SET-04 | **实机**：设置弹窗只列 Project/Commit/Git/Terminal/Focus commit/Push 六项；README 声称全部可重绑 | 与 Action Registry 联动，自动列出全部动作；或修正 README 与 PRD |
| SET-05 | 没有排除目录、文件类型覆写、Favorites 管理、Changelist 管理、Layout 重置 | 按优先级补；至少"排除目录"和"恢复默认布局"很实用 |
| I18N-01 | **实机**：CodeMirror 默认面板英文；ShortcutCapture 的 "Press keys…"/"Click and press…"；Confirm 的 fallback "Cancel/Confirm"；`bin` | 替换 CM 面板；所有面向用户字符串走 `t()`；补 en/zh |
| I18N-02 | "回滚/丢弃/还原/放弃"多词混用；"只读"按钮表示"切到只读"而不是当前状态 | 统一术语表：Discard=丢弃改动、Rollback=回滚、Restore=还原、Read-only=只读（状态）/切换只读（动作） |

### 8.6 性能与响应（PERF-01..05）

| ID | 问题 | 建议 |
|---|---|---|
| PERF-01 | 每 2 秒 `git status` + 两次 `--numstat`，本小仓库实测约 243ms/轮（附录 B.3），大仓库更差；窗口隐藏时虽暂停，但工作台可见时会持续烧 CPU | 轮询只跑 `status --porcelain=v2`；`numstat` 仅在 Commit 窗可见时按需算；空闲 5s/操作后 2s；错误退避；切到别的面板时暂停 |
| PERF-02 | 全量快照订阅：光标移动、每个字符都触发 Workbench 全量重渲染；`ProjectPanel.rows` 依赖整个 `state`，每次轮询都重新 flatten | 选择器订阅（status/tree/tabs/git/settings 分开）；光标状态放编辑器局部；draft 的 dirty 标记节流；`rows` 只依赖 `dirs/expanded/filter/statusVersion`；面板 `React.memo` |
| PERF-03 | `git.detail` 拉整段 diff 只为显示元信息；Drawer 每次单击都请求；双击重复请求 | 结构化元信息 + 单文件懒加载 + LRU 缓存；点击不请求（见 4.3） |
| PERF-04 | `listDirectory` 对每个 entry 串行 `lstat`（5k 文件 = 5k 次），但树并不显示 size/mtime | 树列表不需要 `lstat` 就不做；需要时并发限流；大目录分页/虚拟化 |
| PERF-05 | 无取消/竞态保护：快速输入筛选会发多个 `git.log`；只有 token 防旧响应，`git.status` 没有 | 所有请求带 AbortSignal/搜索 id；旧响应丢弃；loading 状态可见 |

### 8.7 视觉、主题、可访问性（VIS-01/02，A11Y-01）

| ID | 问题 | 建议 |
|---|---|---|
| VIS-01 | 代码高亮/CM 主题写死 `dark: true` 与固定色；浅色主题下代码色/选中色错配；文件图标 tint 也是固定色 | 两套语法 token（light/dark），从 DSH 主题解析；CM `dark` 跟随主题；图标用 `currentColor`+语义色 |
| VIS-02 | 选中蓝有 3 种透明度；字号 10.5/11/11.5/12/12.5/13 混用；`⊟ ⛶ ▤ ★ + × ⋯ ✓` 文本字形与 SVG 图标混排 | 定义 `--itw-selection-*`、`--itw-space-*`、字号阶；文本字形全部换 SVG；统一图标 16px 网格 |
| VIS-03 | 顶部栏 4 个无标签字形按钮；无主菜单；状态栏有重复快捷键提示 | 顶部加 `⋯` 菜单（File/Edit/View/Git/Terminal/Help）；按钮用图标+tooltip；状态栏精简 |
| A11Y-01 | 树/菜单/标签无 `role`、无方向键、菜单无焦点管理、模态无焦点陷阱、toast 无 `aria-live` | 补 ARIA 与键盘；菜单 ↑/↓/Enter/Esc；模态 Tab 循环 + Esc；toast `role=status`；尊重 `prefers-reduced-motion` |

### 8.8 顶部栏、状态栏、面板切换（UX-05…10）

| ID | 问题 | 建议 |
|---|---|---|
| UX-05 | 状态栏首项"就绪"不可点；编码不可点；无通知历史/铃铛；分支 chip 不可点 | 按 PRD 3.6 补齐可点入口；通知中心记录 toast；branch chip 打开分支弹层 |
| UX-06 | 顶部"工作区选择"与 Project 头部"项目选择"两个相似选择器，一个开工作区菜单、一个开项目选择器；用户分不清 | 合并为一个"项目/工作区"入口，弹层里分两组（工作区、项目），或至少在标题上写明"工作区" vs "项目"；当前两者样式几乎一样 |
| UX-07 | Project↔Commit、Git↔Terminal 切换时组件卸载：树的滚动位置、Git 日志滚动、选中详情、重命名/弹窗状态全部丢失；Git 每次重挂都重新 `loadLog` | 保持四个面板挂载，用 `display:none` 切换；至少保存/恢复 scrollTop 与选中态；避免重复请求 |
| UX-08 | 关闭底部 Git/终端面板的 `×` 很小且无确认；关闭终端会杀进程（与 TERM-01 联动） | 关闭终端标签/面板需明确确认；Git 面板关闭不需要但要有 tooltip |
| UX-09 | 错误标题不准确：checkout/revert/discard/ignore 的错误都用 `commit.failed` / "提交失败" | 每个动作自己的错误 key；错误详情可复制 |
| UX-10 | 只支持"两个提交 Compare"；右键只有 5 项；无"与工作区比较" | 补 context 菜单（Open Details/Compare with Working Tree/Open at Revision）；Compare 入口在工具栏可见 |

---

## 9. P2：打磨清单（不阻塞发布，但决定"精品感"）

| ID | 问题 | 建议 |
|---|---|---|
| P2-01 | Project 根选择器只列一级子目录，无搜索/父级导航/最近项目 | 加搜索、键盘、最近使用、"打开上级目录"；二级仓库发现可作为开关 |
| P2-02 | 右键菜单是 20+ 项扁平列表，容易超出屏幕；New File/New Directory 未分组 | 按 PRD 做成 `New ▸`、`Git ▸`、`Copy Path/Reference ▸` 子菜单；菜单超高滚动 |
| P2-03 | 复制路径的无反馈/失败无降级 | 成功后 toast；失败提供手动复制弹窗；区分绝对/相对/文件名 |
| P2-04 | 重命名/移动无 Undo（PRD 承诺可撤销） | 至少为重命名/移动保留一步 Ctrl+Z；或 toast 提供"撤销" |
| P2-05 | 目录只有 `…` 表示截断，无数量/原因 | 显示"仅显示前 5000 项"并提供刷新；排除 node_modules 等 |
| P2-06 | 文件图标 tint 固定、暗色下对比不足；锁文件/配置文件图标语义不清 | 主题双套 tint；根据文件类型增加 tooltip |
| P2-07 | Markdown 预览无"复制全文/在浏览器打开/图片缩放"；相对图片不解析（README 已知） | 加复制/打开；相对图片 URL 解析可作为 P2 |
| P2-08 | 终端无搜索、无清屏、无右键粘贴、无滚动到底部按钮；Ctrl+F 交给 shell，不是查找 | 引入 `@xterm/addon-search`；右键菜单（复制/粘贴/清屏/全选）；Ctrl+F 打开终端查找 |
| P2-09 | 终端关闭面板/标签的确认只在 busy 时；detached 状态无提示 | 明确状态；关闭 running 会话确认；显示 exit code |
| P2-10 | Toast 只有一条、4.5s/9s 消失、无历史 | 队列 + 通知中心 + 手动关闭 + 可复制错误 |
| P2-11 | 无加载骨架/进度条；轮询与搜索无可视反馈 | 列表加载 skeleton；搜索/刷新进度；减少"空白闪烁" |
| P2-12 | 无错误边界；某个组件异常会白屏 | 每面板 ErrorBoundary + 重试 |
| P2-13 | 无快捷键速查表/帮助 | `⋯` 菜单 → Keyboard Shortcuts 弹层，按动作注册表生成 |
| P2-14 | 无最近文件（Ctrl+E） | 基于标签历史/打开记录实现，与快速打开共享索引 |
| P2-15 | 无 `Ctrl+G` 行跳转、无 `Ctrl+Shift+E` 定位当前文件 | 补；小成本高收益 |
| P2-16 | 无"发送到对话/作为上下文"的 DSH 原生集成 | 右键文件 → Add to Chat Context（战略差异点，V3 之后） |
| P2-17 | 无 Compare Directories / Local History / Annotate（PRD 已延期） | 明确不做，写入 V4 backlog，避免用户误解 |

---

## 10. 与 PRD-v2 的差距：不仅是代码，文档也要改

### 10.1 条款对照

| PRD-v2 条款 | 承诺 | 0.3.0 实际 | V3 处理 |
|---|---|---|---|
| 3.1 工具窗三态 / 3.2 标题栏拖拽 | Docked/Floating/Split、Pin/Auto-hide | 只有左/底两个 dock；无三态 | **保持不做**（V3 Backlog），README 明示 |
| 4.1 点击模型 | 单击选中、双击打开；失焦弱化选中 | 点击模型对了；失焦弱化未做；选中与打开同色 | 本文 §5 |
| 4.2 快捷键 | Ctrl+A/Ctrl+D/Ctrl+Shift+F 等 | 多数无 handler；**实机 Ctrl+A 选中侧栏、Ctrl+Shift+F 无反应**；树 F2/方向键可用 | 本文 §7.5 + Action Registry |
| 4.3 拖拽 | 自动展开、no-drop 子树、冲突弹窗 | 无自动展开；仅自身检查；冲突自动改名 | 本文 8.4 |
| 4.4 文件操作 | F5/F6/Shift+F6/Compare/Find Usages/Undo | F5/F6 有；Shift+F6/Compare/Find Usages/Undo 无 | 本文 8.4；Compare 可做，引用更新延后 |
| 4.5 右键菜单 | 大而全、子菜单、快捷键灰字 | 部分项；无 Compare/Find/History 等 | 本文 8.4/P2-02 |
| 4.6 颜色 | 目录递归、忽略、排除、冲突 | 基本有；删除态未聚合；排除无设置入口 | 本文 8.4 |
| 4.8 树过滤 | 按名称过滤、高亮、Enter 定位 | 只过滤已加载；无高亮/计数 | 本文 §3.6 |
| 5.1-5.5 Commit | 两组勾选、Changelist、Group by Dir、Change View、任务 | 大部分有；Changelist active 无效；勾选失败不回滚；缺冲突/发布流程 | 本文 8.2 |
| 6.1 Git 布局 | **上下分栏**，详情可折叠 | 上下分栏，详情 42%，无拖拽/折叠 | **改为左右 Drawer**（本文 §4） |
| 6.2 过滤 | 关键字/哈希/作者多选/日期/分支/路径/结构性 | 关键字（裸正则）/作者文本/分支/路径；无日期/哈希/结构性 | 本文 4.4 |
| 6.3 详情 | 元信息、父提交、复制、文件内联 diff、动作、多选 Compare | 部分元信息、文件列表；无父提交/复制/动作/内联 diff | 本文 4.3 |
| 6.4 Diff | Side/Unified、单词级、折叠、二进制、F7、Jump | Side/Unified、单词级、折叠有；F7/Jump 无 | 本文 8.1 |
| 6.6 Local History | 快照/时间线/回滚 | **未实现** | 保持 V4，明确不做 |
| 7.2 标签管理 | Close Others/All/Right、Copy Path、Reveal、Split、Pin、Color、溢出菜单 | 只有 Close/Others | 本文 8.1（Split/Color 延后） |
| 8.2 冗余入口 | 右键/工具栏/快捷键三处可达 | 多处缺失；菜单与快捷键不一致 | 本文 §7.5 |
| 8.3 Search Everywhere | Ctrl+Shift+A / 双击 Shift | **未实现** | 本文 §3.5 |
| 9.2 API | fs.search / history / blame 等 | 只有 fs/git 基础；无 search | 本文 §3.4 |
| 10 快捷键总表 | 25+ 项 | 一半以上无实现 | 本文 §7.5 |

### 10.2 PRD 必须新增/修订的条款

1. **新增 §4.10 文件内查找**：FindBar、快捷键、计数、大小写/全词/正则、Diff/Markdown、替换范围。
2. **新增 §4.11 全局查找与快速打开**：Find in Files、Search Everywhere、索引与后端、结果模型、取消。
3. **重写 §6.1**：把"上下分栏"改为"左日志 + 右 Drawer"；明确宽/窄屏行为、宽度持久化、焦点管理。
4. **重写 §6.3**：点击模型（单击只选中、双击详情）、Drawer 内容、文件列表字段、动作清单。
5. **修订 §6.2**：分支筛选只做筛选；新增 §6.5"分支切换入口"（顶部弹层 + 确认 + 脏工作区检查）。
6. **修订 §4.1/§7.1**：增加"打开的文件"状态、树失焦弱化、`alwaysSelectOpened` 行为。
7. **新增 §2.6 交互原则**："筛选控件不得产生写操作""破坏性动作默认焦点在取消""所有显示的快捷键必须有 command id"。
8. **修订 §8.2/§10**：以 Action Registry 为唯一事实源；删除未实现的快捷键或补实现；README 不再声称"全部可重绑"。
9. **修订 §7.2**：V3 只做 Close All/Right/Reopen/Overflow，Split/Color 明确延后。
10. **明确 V3 范围**：不做 Local History/Floating/Split/Blame/Stash/Rebase/Replace in Files。

### 10.3 文档写作建议

- 每个交互控件都必须写清"读/写""前置条件""失败态"；本次两个分支下拉的根因就是只写了"分支"两个字。
- 每个快捷键必须对应一个 command id；验收时以"菜单可见 = 快捷键可用"为准则。
- 每个视觉状态必须给令牌名（`--itw-selection` 等），禁止在实现里即兴发明颜色。
- 验收标准要可执行：给出输入、操作、期望、观测方式（CLI/截图/计时）。

---

## 11. 第三轮范围建议与里程碑

### 11.1 范围原则

- **不做新工具窗、不做布局三态、不做 Local History**；先修四条日常回路。
- 每个 P0 必须有"实机验收脚本"，不能只靠单测。
- 先做**动作注册表 + 选中/焦点作用域模型**，再做依赖它们的菜单/快捷键/命令面板；否则会重复返工。
- 搜索与 Git 是本轮的两个"可感知跃迁"，编辑器可复制/可编辑是底线。

### 11.2 里程碑

| 阶段 | 主题 | 必须交付 | 完成标志 |
|---|---|---|---|
| **M1（P0 基座）** | 可信编辑器 + 键盘 + 数据安全 | 只读可复制；FindBar（只读/编辑/Diff/Markdown）；默认可编辑；关闭三选一；外部修改冲突；回滚修复；删除降级确认；确认框焦点；Action Registry + 选中/焦点作用域 + Ctrl+A 隔离 | J1/J2 全流程顺；菜单所有快捷键可用；不再出现两行同色与 Ctrl+A 泄漏 |
| **M2（P0 搜索 + Git）** | 查找闭环 + Git 工作流 | Find in Files + 后端；快速打开/Search Everywhere；树过滤修复；Git Drawer + 结构化详情 + 文件列表；筛选重做；分支弹层；默认当前分支 | J3/J4 顺；Git 270px 高可用；分支控件唯一且无写副作用 |
| **M3（P1 打磨）** | 终端 + Commit + 设置 + 性能 + 视觉 | 终端 detach/reattach；Commit 面板布局/勾选回滚/冲突/发布分支；标签管理；设置清理；轮询/订阅性能；主题 token；i18n/ARIA | J5 顺；10k 仓库首屏/展开/搜索达标；亮暗主题一致 |

> 如果只能做一个里程碑：**M1**，因为它决定"敢不敢把代码交给这个插件"。
> 如果能做两个：**M1 + M2**，这会让插件从"能看"变成"能日常用"。

### 11.3 建议的版本号

- `0.4.0`：M1（编辑器可信 + 键盘 + 数据安全）
- `0.5.0`：M2（搜索 + Git Drawer）
- `0.6.0`：M3（终端持久 + 打磨）
- 不要把 M1/M2 混在一个 PR 里；搜索与 Git 的改动面都很大，分开便于回滚。

### 11.4 需要产品负责人拍板的决策

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 文本默认打开模式 | A 只读（现状） / B 可编辑 / C 按大小分层 | **C**：≤1MB 可编辑，大文件只读，设置可改 |
| 2 | Git 详情形态 | A 上下分栏 / B 右侧 Drawer / C 直接编辑区标签 | **B**，窄屏覆盖式 |
| 3 | Find in Files 位置 | A 编辑器标签 / B 底部面板 / C 左栏 | **A** |
| 4 | 快速打开快捷键 | A Ctrl+Shift+N / B Ctrl+P / C 两者 | **C**，默认 A |
| 5 | 树过滤的去向 | A 升级为全项目快速定位 / B 保留并明确"仅已展开" | **A + B 共存**：输入文件名走快速定位，树内过滤保留 |
| 6 | 终端跨面板持久 | A 做 / B 不做只警告 | **A**（M1 或 M3 首选 M1） |
| 7 | Changelist | A 补完 active 过滤/重命名/删除 / B 本轮移除 UI | **A 的最小版**（active 过滤 + 删除），否则 B |
| 8 | 结构性过滤/日期过滤 | A 补 / B 移除 UI | 日期补；结构性过滤若不做就移除 |

---

## 12. 总验收清单（Definition of Done）

> 每项都必须在真实桌面实例中手工跑一遍；单测通过不等于体验达标。

### 12.0 2026-10-22 实机走查结果（只读）

环境：DSH Desktop，窗口 1619×1029，项目 `dsh-ide-toolwindows`，版本 0.3.0。只做打开/选择/搜索/切换，不保存、不提交、不删除、不切分支。截图在 `docs/assets/v3-live/`。

| 验证项 | 实机结果 | 证据 |
|---|---|---|
| 新标签默认模式 | 新开 `package.json` 为**只读**（工具栏显示"编辑"） | [13-new-tab-readonly.png](assets/v3-live/13-new-tab-readonly.png) |
| 只读 `Ctrl+F` | **无任何反应**（无 FindBar、无浏览器查找） | 同基线 |
| 编辑态 `Ctrl+F` | 出现 CM 默认面板：英文 + 黑块 + 无计数 | [03-codemirror-search.png](assets/v3-live/03-codemirror-search.png) |
| `Ctrl+Shift+F` | **无任何反应** | 同基线 |
| 只读拖选 + `Ctrl+C` | 无选区，剪贴板保持 baseline | [02-readonly-copy-blocked.png](assets/v3-live/02-readonly-copy-blocked.png) |
| 编辑态拖选 + `Ctrl+C` | 成功复制 70 字符 | 03 同场景 |
| 提交 diff 拖选 + `Ctrl+C` | diff 无选区；复制到的是侧栏文本 | 08 同场景 |
| 树焦点 / `F2` / `ArrowDown` | **可用**：F2 进入内联重命名；ArrowDown 移动选中 | [11-f2-works.png](assets/v3-live/11-f2-works.png) |
| 树内 `Ctrl+A` | **未全选节点**，反而选中 DSH 侧栏"新会话/插件/…" | [08-ctrl-a-leak.png](assets/v3-live/08-ctrl-a-leak.png) |
| 打开 vs 选中高亮 | 两行同时蓝；选中 LICENSE 后 package.json 仍蓝 | [01-two-highlights.png](assets/v3-live/01-two-highlights.png) |
| Git 单击提交 | 立即出详情；日志只剩约 5 行，详情被底部截断 | [04-git-single-click.png](assets/v3-live/04-git-single-click.png) |
| Git 双击提交 | 打开 `52216f9` 巨型 diff 标签，无文件导航 | [05-git-double-click.png](assets/v3-live/05-git-double-click.png) |
| 顶部 branch chip | 点击**无任何反应**；筛选行并排两个 `main` 下拉 | 04/05 |
| 树过滤（折叠目录） | 输入 `store.js` 后所有顶层目录显示"加载中..."，无命中 | [14-tree-filter-loading.png](assets/v3-live/14-tree-filter-loading.png) |
| Terminal → Git → Terminal | scrollback 被清空，只剩新提示符 | [06-terminal-scrollback-lost.png](assets/v3-live/06-terminal-scrollback-lost.png) |
| Terminal 状态切回对话再回 IDE | 底部终端面板关闭，会话计数清零 | [07-terminal-closed-after-chat.png](assets/v3-live/07-terminal-closed-after-chat.png) |
| 设置弹窗 | 只列 6 个快捷键；"字号"在终端分组 | [12-settings.png](assets/v3-live/12-settings.png) |
| 右键菜单 | 20+ 项扁平；New File/New Directory 都显示 Alt+Insert | [09-context-menu.png](assets/v3-live/09-context-menu.png) |
| Commit 面板 | 核心控件放得下；`提交并推送` 是小字链接；未跟踪行无状态色 | [10-commit-panel.png](assets/v3-live/10-commit-panel.png) |

**被实机修正的结论**

- ❌ 原 P0「点击树行后焦点丢失、F2/F5/Delete 失效」**不成立**：实机 F2/ArrowDown 正常。已从 P0 表移除，改为 §7.5 的实机修正说明。
- ➕ 新发现「`Ctrl+A` 选中 DSH 侧栏并污染剪贴板」（KEY-03，P1）。
- ✅ 其余 P0（搜索、只读复制、Git 堆叠/单击语义、高亮、终端销毁、分支控件）均得到实机确认。

**本轮未覆盖（仍需在 V3 开发中补验）**

- 保存 / 外部修改冲突 / 关闭确认 / Close Others 的真实交互。
- 删除、回滚、切分支等破坏性操作的 UI 流程（只做了真实 git 层面的回滚复现）。
- 拖拽移动/复制、右键菜单键盘导航。
- 亮/暗主题、125% DPI、窄窗口、10k 文件仓库性能。
- Markdown 预览内查找、Diff 内查找、Git 详情文件列表滚动。

### 12.1 搜索

- [ ] 打开只读文件 → `Ctrl+F` → 输入 → 计数正确 → Enter/Shift+Enter/F3 循环 → Esc 关闭。
- [ ] 只读代码拖选/`Ctrl+A`/`Ctrl+C` 成功；Diff 复制成功。
- [ ] 编辑态 FindBar 替换/全部替换正确，dirty 状态正确。
- [ ] Markdown 预览、提交 Diff 内查找可用。
- [ ] `Ctrl+Shift+F` 全项目搜索：10k 文件首屏 < 500ms；取消 < 200ms；结果定位准确。
- [ ] 树内输入文件名能在未展开目录命中（或明确全项目快速定位）。
- [ ] `Ctrl+Shift+N` 快速打开文件；`Ctrl+Shift+A` 命令面板可执行动作。

### 12.2 Git

- [ ] 270px 高 Git 窗：日志至少 5 行；Drawer 打开后日志不塌陷；可拖宽并持久化。
- [ ] 单击只选中；双击/Enter 打开 Drawer；Esc 关闭且焦点回行。
- [ ] Drawer 元信息完整（含 committer date/parents/refs/copy）；文件列表有状态/统计；内联 diff < 300ms。
- [ ] 筛选与 CLI 基线一致；`[` 不报错；hash 可跳转；默认当前分支；筛选不改变 HEAD。
- [ ] 分支弹层可搜索/键盘；脏工作区阻止检出；检出确认；失败显示真实错误。
- [ ] 大提交不再拉全量 diff 只为元信息；重复打开命中缓存。
- [ ] Compare 可用（Ctrl+click/Ctrl+D/右键），结果正确。

### 12.3 编辑器与数据安全

- [ ] 打开文本默认可编辑（或按决策 C）；`Ctrl+S` 保存；外部修改有冲突提示。
- [ ] 关闭脏标签有"保存/放弃/取消"；Close Others/All 不静默丢修改；刷新前有保护。
- [ ] 回滚已暂存文件后 `git status` 干净；未跟踪文件按设置进回收站；回收站失败二次确认。
- [ ] 删除确认明确回收站/永久删除；失败不静默。
- [ ] 确认框 Enter 不误确认；Esc 取消；焦点在取消。
- [ ] 只读/Diff 可复制；主题切换后代码可读。

### 12.4 键盘与焦点

- [ ] 点击树行后：F2/F5/Delete/↑↓/Enter/Ctrl+A 均生效。
- [ ] 菜单中出现的每个快捷键都能触发（至少抽测 10 个）。
- [ ] 点击树后按 F5 不会刷新页面；Ctrl+D 不会收藏。
- [ ] 聊天输入框内 F11/Ctrl+K 不被插件拦截；Alt+1 等面板键行为符合决策。
- [ ] 菜单可键盘导航（↑/↓/Enter/Esc）；模态焦点不逃逸。

### 12.5 终端与持久

- [ ] `npm run dev` 运行中切到对话 10s 再回：进程/输出/cwd 保持。
- [ ] Terminal↔Git 切换 5 次不丢 scrollback。
- [ ] 关闭终端标签才杀进程；应用退出无孤儿。
- [ ] 终端字体大小设置生效；终端内搜索可用（P2 可后置）。

### 12.6 性能与视觉

- [ ] 10k 文件仓库：首屏 < 1s；展开目录 < 200ms；打字无可感知卡顿。
- [ ] 空闲 2 分钟 CPU 占用可接受（轮询优化后）。
- [ ] 亮/暗主题下：选中/打开/状态色/语法色均清晰；无固定浅色/深色硬编码。
- [ ] 所有面板切换保留滚动与选中；Git 不重复全量加载。
- [ ] i18n 无英文残留（除专有名词）；错误可复制。

---

## 13. 附录

### 13.1 证据索引（源码）

| 主题 | 位置 |
|---|---|
| 全局 `user-select:none` | `src/client/styles.js:53` |
| 代码/差异区无 `user-select:text` | `styles.js:194-214`、`420-436` |
| 只读默认 | `store.js:961`、`418`、`962` |
| CM 默认搜索面板 | `CodeEditor.jsx:16`、`135-141`；`dist/client.js:34912-34962` |
| 全局 button reset（疑似 CM 面板样式冲突） | `styles.js:56` |
| 树过滤不加载目录 | `ProjectPanel.jsx:60-109` |
| 打开/选中同色 | `ProjectPanel.jsx:504-508`、`styles.js:302` |
| 树焦点（实机修正）/ Ctrl+A 泄漏 | `ProjectPanel.jsx:602-611`；截图 `11-f2-works.png`、`08-ctrl-a-leak.png` |
| 头部 + 永远根目录 | `ProjectPanel.jsx:580-583` |
| 两个分支下拉 | `GitPanel.jsx:220-233`、`249-256` |
| 单击拉详情 / 双击开标签 | `GitPanel.jsx:328-332`、`store.js:1664-1675` |
| 详情 42% 高 | `styles.js:511-513` |
| 详情整段 diff | `host/git.js:455-475`、`GitPanel.jsx:111` |
| 回滚只 restore worktree | `host/git.js:329-332` |
| 删除静默永久化 | `host/fileops.js:245-247` |
| 终端清空 | `store.js:494-503`、`TerminalPanel.jsx:142-152`、`index.js:489-492` |
| 关闭无保存 | `store.js:1065-1086`、`1088-1091` |
| 轮询 | `store.js:483`、`505-543`、`host/git.js:236-249` |
| 全量快照 | `hooks.js:4-5`、`store.js:157-160` |
| 全局快捷键 | `index.jsx:130-165` |
| 确认框 autoFocus | `ui.jsx:116-133` |
| 设置字体错组 | `SettingsPanel.jsx:109-114` |
| 设置死项 | `SettingsPanel.jsx:119-137`、`settings-store.js:16-108` |
| 快捷键捕获 | `SettingsPanel.jsx:82-88`、`ui.jsx:149-183` |
| README 承诺 | `README_ZH.md:19-27` |
| PRD 上下分栏/单击 | `docs/PRD-v2.md:393-414`、`430-435` |

### 13.2 复现命令与结果

**B.1 树焦点（实机修正，原结论作废）**

- 实机：点击 `package.json` 行后按 `F2`，进入内联重命名；按 `ArrowDown`，选中从 `LICENSE` 移到 `package-lock.json`。**焦点可用。**
- 之前用通用 Chromium 最小页面得到的 `document.activeElement = BODY` 不能外推到 DSH Desktop 的 Electron/React 组合；该推断已从 P0 移除。
- 同一轮实机发现：树内 `Ctrl+A` 没有全选节点，而是选中了 DSH 侧栏文本（`08-ctrl-a-leak.png`），这才是需要修的作用域问题。

**B.2 回滚不能清除已暂存内容**

```sh
git init -q /tmp/itw-git && cd /tmp/itw-git
git config user.email a@b.c; git config user.name a
echo one > f.txt; git add f.txt; git commit -qm init
echo two > f.txt; git add f.txt
git status --porcelain          # M  f.txt
git restore --worktree -- f.txt
git status --porcelain          # M  f.txt   ← 仍然暂存
```

结论：当前 Rollback 对"仅暂存"文件无效；应使用 `--source=HEAD --staged --worktree`。

**B.3 状态轮询成本**

```sh
cd dsh-ide-toolwindows
time (1..5 | % {
  git status --porcelain=v2 --branch -z --ignored=matching | Out-Null
  git diff --numstat -z --no-renames | Out-Null
  git diff --cached --numstat -z --no-renames | Out-Null
})
```

本小仓库（6 个提交）实测：5 轮约 **1215ms**，即 **243ms/2s 轮询**。仓库越大越差；当前每 2 秒 3 个子进程。

**B.4 Git 搜索正则崩溃**

```sh
git log --all --grep=[ --regexp-ignore-case
# fatal: command line, '[': Invalid regular expression
# exit 128
```

`host/git.js:414` 直接把用户输入拼进 `--grep=`；输入 `[`、`(`、`*` 等会直接报错。且输入 7 位 hash 时 `--grep=7eb0373` 返回 0 条（hash 不是提交消息的一部分）。

**B.5 文本选择被父级禁用**

```html
<div style="user-select:none"><div id="c">hello code text</div></div>
```

```js
const s = getSelection()
s.selectAllChildren(document.getElementById('c'))
String(s).length   // 0
getComputedStyle(document.getElementById('c')).userSelect   // "none"
```

与 `styles.js:53` + 缺少 `.itw-code { user-select:text }` 一致。

**B.6 测试基线**

```sh
cd dsh-ide-toolwindows && npm test
# tests 65 / pass 65 / fail 0
```

测试覆盖了 diff、graph、git 解析、文件操作、SSR 等；**没有覆盖**：查找、`Ctrl+A` 作用域、快捷键、终端生命周期、回滚语义、主题。焦点已由实机补验（可用），但仍建议加回归测试。

**B.7 实机只读走查（2026-10-22 23:09–23:45）**

环境：DSH Desktop，窗口 1619×1029（屏幕坐标 150,0），项目 `dsh-ide-toolwindows`，插件 0.3.0。
方法：Windows `SetCursorPos` + `mouse_event` + `SendKeys` + `CopyFromScreen`；只读操作。

| 操作 | 结果 |
|---|---|
| 双击 `package.json` | 新标签打开；工具栏显示"编辑"→ **默认只读** |
| 只读态拖选 + `Ctrl+C` | 无选区；剪贴板仍是预设的 `ITW_CLIP_BASELINE` |
| 编辑态拖选 + `Ctrl+C` | 复制出 70 字符（lines 2–3） |
| 只读态 `Ctrl+F` | 无任何 UI 变化 |
| 编辑态 `Ctrl+F` | CM 面板：英文 `Find/Replace/match case/regexp/by word` + 黑块按钮 |
| `Ctrl+Shift+F` | 无任何 UI 变化 |
| 点击树行 + `F2` | 进入内联重命名（焦点可用） |
| 点击树行 + `ArrowDown` | 选中从 LICENSE 移到 package-lock.json |
| 树内 `Ctrl+A` | 选中 DSH 侧栏文本；树节点未全选 |
| 提交 diff 拖选 + `Ctrl+C` | diff 无选区；复制到侧栏文本 |
| 单击 Git `2ede1a6` | 详情立即出现；日志只剩约 5 行；详情被底部截断 |
| 双击 Git `52216f9` | 打开巨型 diff 标签（从 README.md 开始） |
| 点击顶部 branch chip | 无任何反应；筛选行两个 `main` 下拉 |
| Terminal → Git → Terminal | scrollback 丢失，只剩新提示符 |
| Terminal 状态切对话 → 回 IDE | 底部终端面板关闭，会话清零 |
| 设置齿轮 | 只列 6 个快捷键；终端组里有"字号" |
| 右键文件 | 20+ 项扁平菜单；New File/New Directory 都显示 Alt+Insert |
| `Alt+0` / `Alt+1` / `Alt+9` | 均可切换 Project/Commit/Git，面板快捷键正常 |
| `Alt+F12` | 打开 Terminal，会话启动正常 |

证据：`docs/assets/v3-live/`（14 张关键截图）；其余临时截图已清理，避免污染仓库。

**本轮未覆盖**：保存/冲突/关闭确认、删除/回滚/切分支的 UI 流程、拖拽、右键菜单键盘、亮暗主题/DPI、10k 仓库性能、Markdown/Diff 内查找、Git 详情文件列表滚动。

### 13.3 术语

| 术语 | 含义 |
|---|---|
| Open（打开的文件） | 当前激活标签页对应的文件；树中粗体 |
| Selected（选中） | 用户当前选择的行；整行背景 |
| Active（激活） | 当前焦点所在的面板/编辑器；与 Selected 正交 |
| FindBar | 编辑器内的查找条 |
| Find in Files | 跨文件内容查找 |
| Drawer | 从 Git 工具窗右侧滑出的详情面板 |
| Action Registry | 动作注册表：菜单/快捷键/命令面板的唯一事实源 |
| Detached terminal | 终端视图已卸载但 PTY 仍在宿主运行的会话 |

---

## 14. 结语

0.3.0 最难得的是"方向对了"：共享仓库模型、预览/固定标签、IDEA 语义着色、分组提交、行级暂存、自绘工作台，这些都是正确的骨架。问题集中在"最后一公里"：搜索、Git 浏览、状态语义、数据安全、键盘可信度——而这五项恰好是用户判断"这是不是一个 IDE"的全部依据。

第三轮不要再用"新增功能"来证明进度。把上面四个 P0 和 J1-J4 四条回路打磨到"闭眼可用"，这个插件就会从"有意思的 DSH 插件"变成"装了就不想卸的 IDE 工具窗"。

---

*本文档是产品输入，不是实现清单。第 11.4 节的决策项需要产品负责人拍板后再进入开发；第 12 章的验收项必须在真实桌面实例中逐条勾选。*
