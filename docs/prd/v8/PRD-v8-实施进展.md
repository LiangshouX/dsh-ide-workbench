# PRD-v8 实施进展 —— 工作台入口归位与视觉精修 · 稳定性加固

> **日期**：2026-11-21
> **分支**：`feat(core)/v8-entry-visual-and-stability`
> **基线**：`feat(core)/issue-fixing-and-enhancement`（`9face89`）
> **规格**：`docs/prd/v8/PRD-v8.md`（本记录**不**改写规格，只记录落地与偏差）
> **产物版本**：core `dsh-ide-workbench` **0.8.0**

---

## 0. 一句话

**工作台的入口归了位、界面换了颜、两个会拖垮 DSH 的隐患被堵上了**，全量测试 **1651 条全绿**，并在实机（`127.0.0.1:3081`）上逐条验收。

---

## 1. 方向 A —— 入口归位（ENTRY-01）

| 项 | 结果 |
|---|---|
| 改动 | `src/client/index.jsx`：**删除** `sidebar.footer.action` 的槽位注册（左侧栏底部、头像上方那个入口） |
| 保留 | `conversation.session.header.utilities`（会话头）与 `conversation.hero.options`（空白会话页） |
| 实机 | 刷新后左侧栏底部只剩「远程控制 / 账号菜单」；**「IDE工作台」不再出现在头像上方**（`document.querySelectorAll('button')` 里只剩 hero 一处） |

> **为什么删得掉**：那条入口自己的注释说它是「always-present fallback」，但会话头入口对**每一个非空会话**都存在，
> hero 入口覆盖空会话 —— 没有任何一个状态是只有它覆盖的。

---

## 2. 方向 B —— 视觉精修（§2）

### 2.1 设计令牌层（§2.3.1）

`src/client/styles.js` 的根令牌块新增 **28 个令牌**：

- **圆角**：`--iwb-radius-xs/sm/md/lg/pill`
- **间距**：`--iwb-space-1..5`
- **动效**：`--iwb-ease`（`cubic-bezier(.2,.8,.2,1)`）、`--iwb-dur-fast`（120ms）、`--iwb-dur`（180ms）
- **表面**：`--iwb-surface-base/raised/sunken/overlay/hover/active/selected/selected-soft/glow`
- **光影**：`--iwb-sheen`、`--iwb-highlight`、`--iwb-shadow-sm/md/lg`、`--iwb-focus-ring`
- **玻璃**：`--iwb-glass`、`--iwb-glass-blur`、`--iwb-glass-edge`、`--iwb-glass-shadow`

### 2.2 字体与排版（TYP-01..05）

- 字体栈升级为 `Inter / Segoe UI Variable Text / 系统栈`，中文回落保留（`Microsoft YaHei UI` / `PingFang SC`）
- 根节点开启 `-webkit-font-smoothing: antialiased` + `text-rendering: optimizeLegibility`
- 面板标题改成**三级字号梯度**里的标题级（12px / 600 / `.06em` 字距 / 大写），不再是「和正文只差一个粗细」
- 根节点开启 `font-variant-numeric: tabular-nums`：行号、字数、增删行、页码全部对齐

### 2.3 按钮（BTN-V-01..06）

- **图标按钮**：ghost → hover 出现 `--iwb-surface-hover` + `translateY(-.5px)` → active 回落 + 内阴影
- **文字按钮**：由「平面描边」改为 **渐变表面 + 顶部 1px 高光 + 柔和外阴影**
- **主按钮**：品牌色渐变 + 品牌色外发光
- **焦点环**：`0 0 0 2px bg, 0 0 0 4px accent`，键盘用户看得见
- 所有按钮都有 `transition`（背景/边框/阴影/位移/透明度）

### 2.4 图标（ICO-01..03）

**Unicode 字形全部退场**：顶栏的 `⊟`/`⛶`、Project 面板的 `⌖`、各处的 `×`/`▾`/`▸`/`✓`/`●` 共 **13 处**换成了 SVG。

- 新增图标：`IconLocate`（十字准星）、`IconFile`、`IconFolder`、`IconFilePlus`、`IconFolderPlus`、`IconCollapseAll`
- `icons.jsx` 补 `IconClose`/`IconCheck` 的使用，`ui.jsx` 补 `ChevronRight`（子菜单箭头）

> **用例守着它**：`tests/workbench-chrome.test.mjs` 扫描 `src/client/**`，任何一个功能字形回来都会让测试变红。

### 2.5 表面与层次（SURF-01..05）

- 顶栏 / 面板头 / 状态栏 / 工具条 = `raised`；编辑区 = `base`；浮层 = `overlay`
- 顶栏给宿主一个**投影**，读作「盖在内容上的盖子」
- 树行 / 文件行 / 菜单项：hover 用 `--iwb-surface-hover`；选中 = 品牌色低透明底 **+ 左侧 2px 品牌色标记**
- 输入框：inset 内阴影（读作「凹进去的井」）+ 聚焦时品牌色描边 + 光晕

### 2.6 「液态玻璃」材质（借鉴用户提供的视觉参考）

参考图是近年的 **liquid glass**：半透明、顶部高光、背后模糊、宽而柔的投影。

**酌情采纳的部分**：这套材质落在**浮层**上 —— 菜单、对话框、提示、浮出层、预览工具条：

```css
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .iwb-menu, .iwb-modal, .iwb-toast, .iwb-outline, .iwb-html-actions {
    background: var(--iwb-glass);           /* 74% 不透明 */
    backdrop-filter: var(--iwb-glass-blur); /* saturate(180%) blur(20px) */
    box-shadow: var(--iwb-glass-edge), var(--iwb-glass-shadow);
  }
}
```

**没有采纳的部分**：密集表面（文件树、编辑器、各类条）**保持实心**。理由有二 ——
① 树后面加模糊会不可读；② 每行一次 `backdrop-filter` 会让滚动掉帧，而仓库的性能闸门不允许。
**用例守着这条界线**：`tests/workbench-chrome.test.mjs` 断言玻璃块里**只能**出现那五个浮层选择器。

> 浏览器不支持 `backdrop-filter` 时保留不透明表面 —— 效果是**加法**，不是依赖。

### 2.7 减少小字（TXT-01..02）

面板标题改用**字距与大小写**表达层级，而不是再挂一行说明；可推断的信息一律交给 tooltip。

---

## 3. 方向 C —— 稳定性加固（§3）

> 这一节的**宿主半边**由一个子代理实施，主代理复核了 diff 并补上了设置页与用例。

### 3.1 终端输出封顶（TERM-01..06）

| 项 | 落点 |
|---|---|
| 上限 | `host/settings-store.js`：`DEFAULT_TERMINAL_OUTPUT_LIMIT = 8 MiB`；设置项 `terminal.outputLimitBytes` |
| 兜底 | `terminalOutputLimit(document)`：缺失 / 非数字 / ≤0 ⇒ 回落默认 |
| 计数 | `src/index.js` `attachTerminal`：按 **UTF-8 字节**（`Buffer.byteLength`）计，不按字符串长度 |
| 截断 | 到达上限 ⇒ **只发一次** `{type:'truncated', bytes, limit}`；之后的输出丢弃；**会话不死**（输入、resize、信号、退出帧都照常） |
| 边界 | `sliceUtf8()` 在 **UTF-8 字符边界**上切，不会切出半个字 |
| 客户端 | `TerminalPanel.jsx`：收到 `truncated` 帧 ⇒ 在终端里**打印一行可见提示**；xterm 的 `scrollback` 封顶 **5000 行** |
| 设置页 | `SettingsPanel.jsx` 新增一行「输出上限（MiB）」，中英双语 |

**实机验收**（`127.0.0.1:3081`）：把上限临时改成 64 KiB，开一个新终端会话，
`1..5000 | ForEach-Object { "y" * 100 }` ⇒ 终端里出现
`[output truncated after 65536 bytes]`（页面被 Chrome 自动翻译成中文），**会话仍然可用**。验收后上限已还原为 8 MiB。

### 3.2 PDF 走二进制（PDF-01..07）

| 项 | 落点 |
|---|---|
| `fs.read` | `host/workspace.js`：PDF **只回元信息**（`kind/mime/size/mtimeMs/path`），**不再有 `data`** |
| 二进制路由 | `src/index.js`：`GET /ide-workbench/raw?root=&path=` ⇒ `application/pdf` + `content-length` + `cache-control: no-store` + 原始字节 |
| 围栏 | 同一 `fence(req)`（403）+ `canonicalRoot`/`resolveInside`（越界 403）+ 非 PDF（400）+ 超限（413） |
| 客户端 | `api.js` `rawUrl()` → `store.rawUrl()` → `pdf-view.js` `fetchPdfBytes()` → `pdf-engine.js` `getDocument({data})` |
| 不驻留 | **store 里不留字节**，只在渲染进程里随文档活着 |

**实机验收**：`/ide-workbench/raw` 返回 **200 / `application/pdf` / 193 字节 / `%PDF-1.4` 开头**；
同一个文件的 `fs.read` 答案里 **没有 `data` 字段**；越界路径 **403**。

---

## 4. 方向 D —— 交互收敛（§4）

| 项 | 结果 |
|---|---|
| Project 面板头 | 由 4 个按钮减为 **3 个**：筛选 / 定位 / 刷新。**「新建文件」删除**（它只能在根目录建一个文件，收口到右键菜单与快捷键） |
| 工作台顶栏 | 由 4 个按钮减为 **1 个**：**设置**。「收起全部」「全屏/还原」「刷新」删除 |
| 功能没少 | 收起全部 ⇒ `Ctrl+Shift+F12`；全屏 ⇒ 宿主右栏按钮 + `F11`；刷新 ⇒ Project 面板的刷新按钮 + 状态栏本来的 2s 轮询 |
| 定位图标 | `⌖`（一小坨黑点）⇒ `IconLocate`（十字准星） |
| Alt+Insert | 新建对话框**自带「文件 / 目录」分段开关**；`Alt+Insert` 沿用上次的类型，`Alt+Shift+Insert` 直接要目录；右键菜单两项**各自的快捷键提示不再撒谎**（`Alt+Insert` / `Alt+Shift+Insert`） |

> 纯函数 `newEntryKindFor(event, lastKind)` 让这条规则可以脱离浏览器验证。

---

## 5. 图片预览的拖动（§6）

**根因**：`ImageViewer.jsx` 的 `onMove` 用的是**从拖动起点算起的累计位移**，却把它**加到当前的 pan 上** ——
pan 随移动次数**平方增长**，轻轻一拖就撞到钳位 ⇒ 「直接跳到最左边」。

**修法**：
1. `image-zoom.js` 新增 `beginDrag()` / `dragPan()`：拖动状态**持有起始时的 pan**，且**永不被覆盖**；
   `panFromDrag()` 是「起点 pan + 位移」的**绝对式**。
2. `ImageViewer.jsx`：拖动中**直接写 DOM 的 transform**（跟手），React 状态**每帧至多提交一次**（不卡）。

> ⚠️ **第一版修法自己也有这个 bug**：`drag.pan = pan` 把起点冲掉了。**实机拖动测出来之后才改对** ——
> 这正是「改动要能在真机上跑一遍」的道理。

**实机验收**：放大到 177% 后左键拖 4 步 × 10px ⇒ 平移依次 **-10 / -20 / -30 / -40**，**逐像素跟手**。

---

## 6. 用例（每个改动都有对应用例）

| 文件 | 条数 | 守着什么 |
|---|---|---|
| `tests/workbench-chrome.test.mjs`（新） | 10 | 顶栏只剩设置、面板头只剩三个按钮、定位按钮是 SVG、**没有 Unicode 字形**、设计令牌齐备、按钮用令牌绘制、玻璃只落在浮层 |
| `tests/image-pan.test.mjs`（新） | 8 | 拖动的 pan 是绝对式、**不累加**、起点不被覆盖、钳位认得缩放 |
| `tests/terminal-cap.test.mjs`（新） | 6 | 转发字节不超过上限、只发一次 `truncated`、会话不被关掉、非法设置回落默认 |
| `tests/pdf-binary.test.mjs`（新） | 9 | `fs.read` 不带字节、二进制路由返回原始字节、越界/非 PDF/超限被拒 |
| `tests/new-entry-layout.test.mjs`（改） | +1 | 新建对话框的「文件 / 目录」开关与它对标题的影响 |
| `tests/render.test.mjs`（改） | — | **不再注册** `sidebar.footer.action`；顶栏**没有**全屏按钮 |
| `tests/perf-slice-git.test.mjs`（改） | — | 当前仓库的标记是 SVG，不是 `✓` |
| `tests/pdf-preview.test.mjs`（改） | — | 契约从 base64 改为二进制 |

**全量**：`npm run verify` ⇒

| 包 | 用例 | 通过 | 失败 |
|---|---|---|---|
| core | 795 | 793 | **0**（2 条因环境缺 `rg` 跳过） |
| codeintel | 830 | 830 | **0** |
| contract | 26 | 26 | **0** |
| `verify:split` | — | — | 通过 |

---

## 7. 实机验收清单（`127.0.0.1:3081`，DSH Desktop profile）

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 左侧栏底部（头像上方）**不再**有工作台图标 | ✅ 只剩「远程控制 / 账号菜单」 |
| 2 | 会话头 / 空会话页的入口仍在 | ✅ |
| 3 | Project 面板头 = 筛选 / 定位 / 刷新 | ✅ 三个 |
| 4 | 工作台顶栏 = 设置 | ✅ 一个 |
| 5 | 图片拖动逐像素跟手 | ✅ -10/-20/-30/-40 |
| 6 | 终端输出封顶并可见提示 | ✅ `[output truncated after 65536 bytes]`，会话存活 |
| 7 | PDF 走二进制路由 | ✅ 200 + `application/pdf` + 193 字节；JSON 无 `data`；越界 403 |
| 8 | 玻璃材质落在浮层 | ✅ `backdrop-filter: saturate(1.8) blur(20px)` |
| 9 | 明暗两套主题 | ✅ 两套都截图留档 |

> 安装方式遵循 `AGENTS.md` 的纪律：`npm run build` → `npm pack` → `plugin_manager install_bundle`（**tarball**），
> 桌面 profile 的 `dsh-ide-workbench` 由 **0.7.0 升到 0.8.0**。**不需要重启 DSH**：插件 fiber 被重新装载，
> 宿主半边与客户端半边都换成了新的一份。

---

## 8. 偏差与遗留

| # | 项 | 说明 |
|---|---|---|
| D1 | **ICO-02 的图标网格** | 规格写的是 24×24 视框 / `stroke-width: 1.6`；实现**沿用了图标集既有的 16×16 网格 / 1.35**。理由：整套图标都是按 16 网格画的，改网格要重画全部 30 多个图标，收益不抵风险。**规格的 ICO-02 以「与既有图标集一致」为准**。 |
| D2 | **面板标题大写** | 规格没有明说标题的大小写；实现用了 `text-transform: uppercase` + `.06em` 字距（IntelliJ 工具窗头的做法）。中文标题不受影响。 |
| D3 | **版本号 0.6.0 → 0.8.0** | 本轮带视觉重做与稳定性修复，是一次**发布级**改动；版本随发布物一起升。根 `package.json` 同步。 |
| D4 | **`EditorArea.jsx` 的一行 prop** | 由子代理改动：`data: payload.data` ⇒ `url: store.rawUrl(tab.path)`（PDF 新契约所必需）。该文件不在子代理的清单里，属**必要越界**，已复核。 |
| D5 | **终端上限的可配置项** | 规格只要求「可配置 + 默认值兜底」；实现把它放在了设置页的终端分组里（MiB 为单位），键名 `terminal.outputLimitBytes`。 |
| L1 | **代码智能（codeintel）** | 本轮**未**触碰；`packages/codeintel` 的 830 条用例保持全绿。 |
| L2 | **已发布的 0.7.0 的注释乱码** | 排查时发现：npm 上的 `dsh-ide-workbench@0.7.0` 的 `src/index.js` 注释是**乱码**（`—` 变成 `鈥?`、`─` 变成 `鈹€`）—— 打包时的编码问题。本地这一份是好的。**不在本轮范围**，但值得在发布流程里查一下。 |

---

## 9. 下一步

1. **发布**：core 0.8.0 的 tarball 已在 `../.offline-stage/`；`CHANGELOG.md` 与 `README` 的截图还没更新。
2. **剩余的零碎说明小字**：TXT-01 只处理了面板标题一类，其余说明行还在。
3. **液态玻璃的边界**：如果宿主将来给密集表面也上了玻璃，`.iwb-tree-row` 一族要重新评估（可读性 + 性能闸门）。
