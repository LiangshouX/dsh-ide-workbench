# PRD-v6 增强需求 —— core 白屏修复与三项体验增强

> **状态**：**已实施并实机验收**（2026-11-03）。
> **代码基线**：`dsh-ide-workbench` `33ff4d4`（V6 拆分后的 monorepo，`packages/{contract,workbench,codeintel}`）。
> **触发**：用户反馈——单独安装 workbench（core）后 IDE 工作台打开即白屏不可用；同时提出三项 V6 体验增强。
> **前序规格**（只读）：`PRD-v6-插件拆分.md`、`PRD-v6-实施契约.md`、`PRD-v6-实施进展.md`。
> **本文覆盖**：一个 P0 缺陷（两个叠加根因）+ 三个 P0 增强 + 一个顺带发现的跨 profile 写设置缺陷。

---

## 0. 一页速览

| ID | 条目 | 类型 | 一句话验收 | 结果 |
|---|---|---|---|---|
| **DEF-01a** | 发布的包缺 `src/contract/` ⇒ 宿主半边 import 失败，插件整体不挂载 | 缺陷 | 只装 core 时入口出现、点开不再是空面板 | ✅ 已修 |
| **DEF-01b** | 「非扩展值」被当扩展安装 ⇒ 编辑器挂载即抛错，React 卸载整个工作台 ⇒ 白屏（core-only 与双装各有一条触发路径，见 §1.2.2） | 缺陷 | core-only 与双装下 `.cm-editor` 都真的挂载，工作台不消失 | ✅ 已修 |
| **ENH-01** | Project / Commit / Git / Terminal 四个入口可配置在左/右，**默认右**，设置页可改 | 增强 | 默认右侧；设置页切左/右即时生效并持久化；左模式与旧版逐像素一致 | ✅ |
| **ENH-02** | Git diff 保留原始空白、单词级差异默认开启、超长行可左右滚动 | 增强 | 并排两栏各占一半、各自横向滚动且联动（同位置）；统一模式单一滚动面；逐字符保真；Aa 默认开 | ✅ |
| **ENH-03** | 行号右键「Annotate with Git Blame」→ **行号左侧的内联注解列**（`日期 作者`；未提交行留空）→ 点击跳转 Git 提交 | 增强 | 右键→列出现→点击→Git 打开并定位该提交，全链路可用 | ✅ |
| **ENH-04** | 内容工具栏被压窄时文字换行（「编/辑」「utf-/8」） | 缺陷 | 文字永不换行；条再窄就只留图标（文字进 tooltip），编码只留首字母（`utf-8` → `u`） | ✅ 已修 |
| **ENH-05** | 全局查找 `Ctrl+Shift+R` 在拆分后又退回**标签页**（把当前文件挤走）；`Ctrl+F` / `Ctrl+Shift+R` 都不认选中的文本 | 回归 + 体验 | 搜索在**弹窗**里（不加标签、不离开当前文件）；有选中文本时直接带入搜索框 | ✅ 已修 |
| **DEF-02** | `profileBase()` 优先 `DSH_PROFILE_DIR`（从父 shell 继承）⇒ 从另一 DSH 终端启动的实例把设置写进**另一个 profile** | 缺陷 | 设置文件永远落在本进程真正服务的 profile | ✅ 已修 |

**验收数字**：core **483** / codeintel **818** / 契约 **26** 测试全绿；`verify:split` **25/25**；实机全链路脚本 **62/62**（0 console/pageerror）。

---

## 1. DEF-01：core 单独安装白屏

### 1.1 现象

只安装 `dsh-ide-workbench`（不装 codeintel）时，DSH 右侧栏的「IDE 工作台」入口/残留标签页仍在，点开后工作台区域**空白/不可用**；同时安装 codeintel 时正常。

### 1.2 两个叠加的根因（互相独立，都会造成「打不开」）

#### DEF-01a 发布包白名单漏了契约副本

`packages/workbench/src/index.js` 静态 import `./contract/index.js` 与 `./contract/fault-registry.js`，但 `package.json` 的 `files` 白名单只写了 `src/index.js` 与 `src/host`。`npm pack` 出来的 tarball 因此**不含 `src/contract/`**：

- 宿主半边 `failed to import`（DSH 日志：`ide-workbench (dsh-ide-workbench): failed to import`）；
- 客户端插件不在 `__DSH_BOOT__` 里 ⇒ 入口/标签页消失，若 profile 里残留旧版布局，点开就是空面板；
- 源码级检查看不见它（文件就在磁盘上），只有「打包后的产物」能暴露。

**修复**：两个包的 `files` 各加一行 `"src/contract"`。**防回归**：`scripts/verify-split.mjs` 新增「entry 的相对 import 图必须全部落在 `files` 白名单内」+ 四个必需产物检查；已做负向验证（删掉 `src/contract` ⇒ FAIL 并列出两个漏掉的文件）。

#### DEF-01b 「非扩展值」被当扩展安装（真正的「白屏」）

CodeMirror 会把 `extensions` 里的数组摊平，然后对每个元素做类型判定；一个**原始的键绑定数组**
（`[{ key, run }]`）不是 Extension，`EditorState.create` 会抛
`Unrecognized extension value in extension set ([object Object])`。这个错误发生在编辑器挂载的
effect 里 ⇒ React 卸载整个工作台子树 ⇒ **右侧栏一片白**（slot 边界把错误吞掉，页面无 pageerror）。

同一形状的缺陷有**三处**，触发路径不同：

| # | 位置 | 触发条件 | 说明 |
|---|---|---|---|
| 1 | `packages/workbench/src/client/editor-seam.js`：`extensions: [closeBrackets(), closeBracketsKeymap]` | **只装 core** | core 的 `closeBrackets` 槽位 priority 0；双装时被 codeintel 的 priority 100 顶掉，所以历史上被掩盖 |
| 2 | `packages/codeintel/src/client/extensions.js`：同一行 | **双装** | 双装时这个槽位**胜出**，于是坏扩展被真正安装 |
| 3 | `packages/workbench/src/client/CodeEditor.jsx`：`keymapCompartment.of(seam?.keymap ?? [])` / `reconfigure(seam.keymap)` | **双装** | `EditorSeam.keymap` 是**摊平后的绑定数组**（契约的 `registerKeymap` 接受绑定，不包装）；core 自己不注册绑定，所以只有 codeintel 注册了语义快捷键后才会崩 |

**修复**（三处都要，缺一不可）：

- core/codeintel 的槽位：`keymap.of(closeBracketsKeymap)`；
- core 的编辑器：`keymapCompartment.of(keymap.of(seam?.keymap ?? []))` 与
  `keymapCompartment.reconfigure(keymap.of(seam.keymap))`；
- 回归测试：core 用真实 `EditorState.create` 校验槽位；codeintel 用同一实例校验「双装胜出的那个
  槽位」是合法扩展集；`client-contract.test.mjs` 钉住 `keymap.of` 包装；实机新增双装态验收
  （打开文件后 `.cm-editor` 存在、工作台不消失）。

> 三条路径**互相独立**：只装 core 触发 #1；双装触发 #2（槽位胜出）与 #3（快捷键注册）。
> 只修 #1（最初的判断）会让「双装」继续白屏 —— 这是实机双装验收抓到的第二个缺陷。

> 与 DEF-01a 的先后关系：DEF-01a 让插件整体不挂载（入口都没了）；DEF-01b 让「插件挂上了、
> 但一打开编辑器就白」。用户现场更可能是 DEF-01b（旧版布局残留标签页 + 只有 core 时编辑器崩溃）。

### 1.3 验收

| 场景 | 手段 | 结果 |
|---|---|---|
| 只装 core（全新 profile） | 实机：点入口 → 工作台渲染 → `.cm-editor` 挂载 | ✅ |
| 只装 core（缺 `src/contract` 的坏包，对照） | 实机：宿主 `failed to import`、入口消失、客户端未加载 | ✅ 复现 |
| 只装 core + 残留旧版布局 | 实机：修复后点开正常渲染 | ✅ |
| 双装（core+codeintel） | 见 §5 | ✅ |
| 打包完整性 | `verify:split` 25/25（含负向验证） | ✅ |

---

## 2. ENH-01：四个工具入口可配置在左/右（默认右）

### 2.1 需求

四个工具入口（Project / Commit / Git / Terminal，现为工作台左缘的竖条，窄面板时变顶部横条）改为**可配置**：默认**右侧**，设置页可切换。右侧布局让「聊天区 ↔ 代码内容区」相邻，不再被文件树隔开。

### 2.2 设计

| 项 | 决定 |
|---|---|
| 设置键 | `settings.layout.entrySide` ∈ `{'left','right'}` |
| 默认值 | `'right'`（宿主 `DEFAULT_SETTINGS.layout.entrySide`；客户端 `layout.js:DEFAULT_ENTRY_SIDE` 兜底，settings 未加载也为右） |
| 实现 | 根节点类 `iwb-root iwb-side-{left\|right}`；右模式**仅用 `.iwb-side-right` 前缀**改 `order`（center→dock→stripe）、镜像边框/选中指示条/resizer；**左模式零新增选择器** ⇒ 与旧版逐像素一致 |
| 拖拽 | 右模式下左侧栏宽度增量取反，同一手势在两侧都「向外变宽」 |
| 窄面板 | `@container (max-width: 560px)` 内重置 order/边框/指示条 ⇒ 两种模式堆叠时都是「入口在顶部横条」 |
| 设置页 | 新增「布局 → 工具窗口入口位置」下拉，`store.updateSettings({ layout: { entrySide } })` 直写，工作台即时翻转 |

### 2.3 兼容性

- 左模式不新增任何 `.iwb-side-left` 选择器（测试断言）；旧布局与旧设置文件（无该键）读出来就是右（用户要求的新默认）；
- 设置文档 `SETTINGS_VERSION` 3 → 4：只新增 `layout.entrySide` 与 `git.wordLevel` 两个键，读旧文件是**深合并**（不丢用户任何键）。

---

## 3. ENH-02：diff 保真、单词级默认开、超长行横向滚动

### 3.1 三个缺陷

| # | 现状 | 根因 | 修复 |
|---|---|---|---|
| 1 | 并排 diff 里缩进与连续空格被吞 | `.iwb-diff-side-cell` 没有 `white-space: pre`（HTML 折叠空白） | 并排单元格 `white-space: pre`；`.iwb-diff-scroll` `tab-size: 4`；统一模式原本就有 `pre`，回归确认 |
| 2 | 单词级差异默认关闭 | `DiffView` 的 `wordLevel` 初值 `false` | `wordLevelDefault(settings) = settings?.git?.wordLevel !== false`（缺省开、仅显式 false 关）；切换先本地生效再 `settings.update({git:{wordLevel}})` 持久化，写盘失败不回滚 |
| 3 | 超长行看不到尾部、无法左右滚动 | 虚拟化行绝对定位、无自身宽度；并排单元格 `overflow:hidden`；外层没有可滚动宽度 | 每个滚动面各自测量可视行最宽处，写到 `.iwb-diff-inner` 的 `min-width: max(100%, calc(Nch + Xpx))`；统一模式是**一个**横向滚动面，并排模式是**每栏一个**（见 §3.2） |

### 3.2 宽度模型与两栏滚动（写死在 `diff.js`）

- chrome 宽度：统一 `22(gutter)+44+44(两个行号)+16(sign)+24(padding)=150px`；并排**单栏** `22+44+24+1=91px`（每栏各算一次）；
- 文本宽度按码元计：`tab` 跳到 `tab-size:4` 的停位，CJK/韩文/emoji 计 2 列（UAX #11 近似，偏保守，宁可宽一点）；
- 只量 `context/add/del` 行；文件头/hunk 头是 chrome（原本就 `ellipsis`），不撑宽；
- **并排 = 两个窗格（pane）**，各占内容区一半（`grid-template-columns: minmax(0,1fr) minmax(0,1fr)`，随内容区拉伸而等分），**各自**是一个滚动面：
  - 每栏的内层宽度按**本栏**最宽的行算（`diffPaneWidths`），所以左栏的长行不会强迫右栏滚动，反之亦然；
  - 两栏的 `scrollLeft` / `scrollTop` **联动**：拖左栏的横向条，右栏以**相同的位置**（同一「距左端点的距离」）跟随，反之同理；
  - 可滚动长度不一致时按「左对齐」：较短的那栏由浏览器夹到自己的端点就停，并且**夹取的结果不会回传给用户正在拖的那一栏**（程序化写入记在 `echoRef` 里，其回声事件被识别并忽略）；
  - 竖向滚动条只画在右栏（左栏用 `::-webkit-scrollbar { width: 0 }` 只隐藏竖向、保留横向），分割线上不会多出一条竖向滚动条。

### 3.3 已知限制（记录）

`ch` 是按字体宽度解析的近似单位，极端字形（含宽字符混排）可能低估几个像素，因此每栏内层宽度是「够用就好」的保守估计；溢出部分由该栏自身的横向条带回。两栏各自滚动是刻意的：这是 IDE 的做法，代价是同一行在两栏里的横向位置可能不同（联动保证的是「同一个起点偏移」，不是「同一列像素」）。

---

## 4. ENH-03：Git Blame annotate

### 4.1 交互（对齐 IDE）

1. 内容区打开的文件，在**行号**上右键 → 菜单首项「Annotate with Git Blame / 注解 Git Blame」；
2. 编辑器出现一条**内联注解列**：位于**行号左侧**的一列（CodeMirror gutter，`Prec.high` 排在行号之前），每行一格，单元格只显示 **`YYYY/M/D 作者`**（与 IDE 的 annotate 视图一致；hash 与提交摘要在悬停提示里）；
3. **未提交的行（工作区里改动/新增、hash 全 0）该行单元格留空**，不打印伪作者；
4. 点击某个单元格 → 打开 Git 工具窗口、选中该提交并打开详情抽屉（复用现有 `openBlameCommit`）；
5. 同一处右键菜单在注解开启时多一项「关闭 Git 注解」，用来关掉这一列。

保留既有右键语义：有选区时仍出「发送到聊天/复制 + 插件命令」；非行号区域的无选区右键**不拦截**（仍走系统菜单）。

### 4.2 宿主

- `src/host/git.js`：`blame(env, repoPath)`（`git blame --porcelain -- <path>`，不加 `-w`：空白改动也是真实改动）+ `parseBlame()` 状态机：同 hash 继承元数据、`^` boundary、CRLF、未终结输出不产生幽灵行、行上限 `MAX_BLAME_LINES = 20000`（超出 `truncated`）、超时 20s；未提交行（全 0 hash）→ `committed:false` / `Not Committed Yet`；「文件无提交」返回空结果而不是报错。
- `src/index.js`：新增 `git.blame` 路由（`repoEnv` + `toRepoPath`，与既有 git 路由同一套围栏）。

### 4.3 客户端

- `store`：`state.blame`（open/path/line/loading/error/lines/commits/truncated）+ `annotateBlame/closeBlame/openBlameCommit`；token 防竞态；切/关 tab、切项目、删除文件、切换仓库时清理；
- `CodeEditor.jsx`：`gutterLineOf()` 解析行号（折叠范围取首行，非数字回退 `posAtCoords`）+ 行号右键菜单；新增 `blameCompartment`，按 `blame.open && blame.path === path` 把注解 gutter 装/卸，并把行数据经 `setBlameAnnotations` 写进 `blameField`（不重建文档、不进 undo 历史）；
- 新 `blame-gutter.js`：`blameDate()`（本地 `YYYY/M/D`，不补零）、`blameLabel()`（`date author`；未提交 → `''`）、`blameMapOf()`（丢掉未提交/零 hash/非法记录）、`blameGutter()`（`Prec.high(gutter({...}))`；单元格点击走 live ref 跳转提交）；
- `EditorArea.jsx`：只把属于当前 tab 路径的 blame 切片交给编辑器（切换 tab 后迟到的应答不会标错文件）。
- 旧版右侧 `BlameView.jsx` 与 `.iwb-editor-main` 行式布局**已移除**。

---

## 4A. ENH-04：窄面板的内容工具栏只留图标

### 4A.1 现象

内容区被压窄时，工具栏右侧那组控件（预览 / 源码 / 编辑 / 保存 / utf-8）会**在按钮内部换行**，出现「编/辑」「utf-/8」这种两行字挤在 30px 条里的样子；条本身也被撑成两行。

### 4A.2 需求

1. 文字**永不在控件内部换行**：控件不收缩（`flex: 0 0 auto`）、文字不折行（`white-space: nowrap`），空间不够时先让路径折叠；
2. 条再窄就切「紧凑」：**只留图标**，原文字进按钮的 `title`（悬停提示）；编码只留**首字母**（`utf-8` → `u`、`GBK` → `G`），完整编码与换行符（LF/CRLF）进 `title`；
3. 切换**按实测宽度**决定，不是写死屏幕宽度：控件量出自然宽度，加上「路径至少要留 140px」的预算，与工具栏实际宽度比较。这样换语言（更长的译文）、换字号、换主题时，switching 点自己跟着走；
4. 测量在 `useLayoutEffect` 里做（先按「不紧凑」量，再决定），浏览器不会画出「先折行再收紧」的中间态。

### 4A.3 实现

- `EditorArea.jsx`：`toolbarRef` / `actionsRef` / `compact`；右侧控件包进 `.iwb-toolbar-actions`（测量单元）；文字包进 `.iwb-toolbar-label`；编码拆 `.iwb-encoding-full` / `.iwb-encoding-short`（`util.shortEncoding()`）；根节点写 `data-compact='true' | 'false'`；
- `styles.js`：控件与标签 `nowrap` + 不收缩；`[data-compact='true']` 下隐藏标签与完整编码、显示首字母、按钮收紧内边距；
- 回归：`tests/toolbar-compact.test.mjs`（4 例：首字母规则、标签包裹、编码 tooltip、`data-compact` 规则与测量接线），实机 lead-verify 用「拖宽 dock 压窄内容区」验证宽/窄两态与 tooltip。

---

## 4B. ENH-05：全局搜索回到弹窗，且「选中即带入」

### 4B.1 现象

拆分（`64ef48f`）把 `SearchPopup.jsx` 搬进了 codeintel，于是 core 的全项目查找又退回**标签页**形态：`Ctrl+Shift+R` 会在编辑器里开一个 `search:in-files` 标签，把用户正在看的文件挤走（PRD-v5 FIND-01 的回归）。同时两个查找入口都不认「当前选中的文本」——IDE 里选中一个词按 `Ctrl+F` / `Ctrl+Shift+R`，搜索框里就是那个词。

### 4B.2 需求（对齐 PRD-v5 FIND-01 / FIND-02 + IDE 习惯）

1. **弹窗，不是标签**：顶部浮出式（复用 Quick Open 骨架，`z-index: 70` 高于所有 modal），`min(900px, 92vw)` × `min(640px, 80vh)`；上半 40% 是**文件列表**（每个命中文件一行 + 命中数），下半 60% 是选中文件的**命中预览**（每条命中带上下文行）；**不新增 tab、不切换当前文档**；
2. 交互：单击文件行只预览；双击文件行 / 双击命中块 → 打开文件并定位到行:列，**同时关闭弹窗**；`Esc` / 点遮罩 / 点 ✕ 关闭；`↑↓` 选文件、`Enter` 打开、`F8`/`Shift+F8` 在文件间移动；
3. **选中即带入**：`Ctrl+F`（文件内 / Markdown 预览）与 `Ctrl+Shift+R` 在触发时若存在选中文本，直接把它填进搜索框：
   - 编辑器的选中优先（CodeMirror 的选区），其次是页面选中（渲染后的 Markdown、或页面任意可选文本）；
   - 单行选中按原样（保留行内空格，搜索是字面量）；多行选中取**第一条非空行**（全项目查找是逐行 grep，多行块永远搜不到）；
   - **空选不清空**：没有选中时，搜索框里用户已经输入的内容保持原样；
   - 查找框内再按 `Ctrl+F` 不覆盖已输入的查询（焦点已经在框里，框是选区的主人）。

### 4B.3 实现

- **core 新组件** `SearchPopup.jsx`：`searchPopupSlice(state) = { search, popup }`（自订阅，编辑区不被搜索结果重渲染）；`generation` 标记每次打开，弹窗从 `store.state.search` 取那一轮的 query/flags 作种子，`seeded` 门闩保证「同一 tick 里被重置的旧值」不会触发一次全项目搜索；
- **store**：`state.searchPopup = { open, index, generation }` + `openSearchPopup(query)` / `closeSearchPopup()` / `moveSearchSelection(delta)` / `selectedSearchFile()`；`openSearchResult()` **先关弹窗再开文件**（一次性工具）；删除 `openSearchTab`、`openNextSearchResult`、`searchHits`；切项目时关闭弹窗；
- **挂载点**：`Workbench.jsx` 根节点（没有打开任何文档也能用），`Ctrl+Shift+R` / `Ctrl+Alt+F` → `store.openSearchPopup(selectedText())`，编辑区工具栏的「在文件中查找」同一条路；旧 `SearchView.jsx` 与其标签页样式删除；
- **选中带入**：`util.findSeed()`（trim、取首条非空行、400 字上限）+ `util.selectedText()`（读页面选区并归一化）；`FindBar` / `DomFindBar` 加 `seed = { text, nonce }`，`nonce` 变即重新预填，`EditorArea` 维护 `findHint` / `previewHint`；
- **顺带修掉一个真缺陷**：切标签后 `EditorArea` 的 `[active?.id]` effect 会 `setEditorApi(null)`，而 React 先跑子组件 effect ⇒ 刚挂载的编辑器交出的 API 被清掉，`Ctrl+F` **静默不弹查找条**。现在 API 只由编辑器自己交还（卸载时 `onReady(null)`），父 effect 只关查找条；
- **i18n / 样式**：`search.popup.{matches,matchCount,noPreview,binary,hint}`（中英）；core 样式表补 `.iwb-search-popup*`（与 Quick Open 同一骨架），删掉旧的标签页样式；codeintel 保留自己的一份（它那条「查找用法（文本）」仍用同名类，两个包各自注入、互不依赖）；
- **回归**：`tests/search-popup.test.mjs`（7 例）、`tests/search-seed.test.mjs`（8 例，含「切标签不清 API」）、`tests/render.test.mjs` 弹窗 SSR、`tests/store-ui.test.mjs` 弹窗状态机、`tests/shortcuts.test.mjs` 种子接线、`tests/perf-slice-editor.test.mjs` 切片自订阅；实机 lead-verify 4b 段（双击选词 → `Ctrl+F` 预填 → `Ctrl+Shift+R` 预填且**不加标签** → 列表/预览/`Esc`）。

---

## 5. 顺带修复：设置写进了别的 profile（DEF-02）

`profileBase()` 原先优先 `process.env.DSH_PROFILE_DIR`。这个变量由**父 shell** 继承：从一个 DSH 的终端（或本仓库的实机夹具）里再启动 `dsh --profile X`，子进程仍带着**上一个** profile 的路径 —— 插件于是把 `ide-workbench/settings.json` 写进了那个 profile。本次实机验收中真实发生了（夹具把设置写进了用户的 desktop profile）。

**修复**：两个包的 `apply()` 在创建设置存储**之前**执行 `setProfileBase(ctx.get('profileContext')?.dir ?? '')`；`profileBase()` 先看它，再退回环境变量（`profileContext` 是 DSH CLI 在挂载前 `provide` 的服务，带 `{ name, dir }`）。新增 `packages/*/tests/profile-dir.test.mjs`（6 例）。

---

## 6. 验收

| 层 | 命令 / 手段 | 结果 |
|---|---|---|
| 单元 | `cd packages/workbench && npm test` | **483 pass / 0 fail** |
| 单元 | `cd packages/codeintel && npm test` | **818 pass / 0 fail** |
| 契约 | `npm run test:contract` | **26 pass** |
| 机械 | `npm run verify:split` | **25 / 25**（新增打包完整性 5 项 + 负向验证） |
| 实机 | `.e2e/lead-verify.mjs`（真 DSH + 打包产物 + Playwright） | **62 / 62**，0 console / pageerror |
| 实机 | core-only 冒烟（`.e2e/smoke.mjs`） | ok，四窗 + 编辑器 + `/ide-workbench/api/*` 全 200 |
| 实机 | 升级路径 0.5.0 → 0.6.0（`.e2e/upgrade-0.5-to-0.6.mjs`） | **19 / 19**：布局保留、不再白屏、`editorAfterUpgrade=true`、设置版本 5→4、用户设置/`lsp` 段全部保留 |
| 实机 | 双装 core+codeintel（`.e2e/dual-install.mjs`） | **13 / 13 全 true**（含 `editorWorks`、两端 `/api` 200、两个 settings 都落在 fixture profile、无 pageerror） |
| 实机 | 缺 `src/contract` 的坏包对照 | 复现「宿主 failed to import、入口消失、客户端未加载」 |

**实机断言摘要**：默认 `iwb-side-right` 且 stripe 在最右 → 设置页选「左」→ 根类翻转、stripe 在编辑器左侧 → 选回「右」；并排 diff 是**两个等宽窗格**（375px 内容区 → 187.5+187.5）、`white-space:pre`、8 空格缩进/连续 3 空格/行尾空格保留、Aa 默认高亮、两栏各自可横向滚动、拖左栏到 240px 后右栏也是 240px、拖右栏到 120px 后左栏也是 120px、滚到本栏末尾时另一栏夹在自己的端点且不回拉；统一模式仍是 1 个滚动面、0 个窗格；行号右键菜单含注解项、注解列在**行号左侧**且单元格只有 `日期 作者`、点击后 Git 抽屉显示该提交、改动未提交的行在列里**留空**；双击选中 `createCounter` 后 `Ctrl+F` 的输入框就是它、`Ctrl+Shift+R` 的弹窗输入框也是它、且标签数不变（搜索不占标签）、弹窗给出文件列表（2 文件 7 处）与带上下文的命中预览、`Esc` 关闭；工具栏 675px 时带文字（`data-compact='false'`），把 dock 拖宽压到 375px 时 `data-compact='true'`、标签隐藏且**仍是一行**（高 30px）、编码变 `u` 且 tooltip 仍是 `utf-8 · LF`；设置文件只落在夹具 profile（`version:4 + wordLevel:true + entrySide:'right'`）。

---

## 7. 风险与已知限制

| # | 项 | 说明 |
|---|---|---|
| 1 | 默认值变更 | `entrySide` 默认 `'right'`：升级后旧用户会看到入口换到右侧（这正是需求）。想要旧布局可在设置页改回左。 |
| 2 | `ch` 宽度是近似 | 见 §3.3；偏保守不裁切，但不保证「恰好到边」。 |
| 3 | blame 折叠行 | gutter 行号解析对折叠行取折叠范围首行；坐标回退分支在极端虚拟滚动下可能偏一行。 |
| 4 | `selectEditorSlice` 含 `blame` 对象 | 每次 blame patch 会重渲染编辑区（已注释说明），不重建 CodeMirror 文档。 |
| 5 | 大文件 blame | 输出先整体缓冲再截断到 20000 行；5 万行以上文件仍会占一次较多内存。 |
| 6 | 并排两栏各自滚动 | 每栏一个横向滚动面（§3.2）：联动保证「距左端点相同的偏移」，不保证「同一个像素列」。若以后要「两栏同列对齐」，需要把两侧宽度统一成 `max(左, 右)` 再联动，代价是短的那栏也永远能滚到别人的长度。 |
| 7 | 弹窗样式两个包各有一份 | core 与 codeintel 都定义 `.iwb-search-popup*`（外观相同、各自注入 `<style>`）：core 的查找弹窗不依赖 codeintel，「查找用法（文本）」也不依赖 core；将来调整外观要两边一起改。 |

## 8. 非目标

- 不做行内 blame 逐行标注（IDEA 的 gutter 作者列）——本轮只做「侧栏提交块 + 跳转」；
- 不改 diff 的暂存/hunk 交互语义；
- 不把 CodeMirror 提升为 DSH 平台模块；不改 DSH 宿主。
