# dsh-ide-toolwindows — V2 产品规格（JetBrains 化）

| | |
|---|---|
| 版本 | v2.0-draft |
| 状态 | 待产品负责人评审（决策项见 13 章） |
| 上一版 | `docs/prd/v1/PRD-v1.md`（v0.2，V1 已交付 0.2.1） |
| 目标读者 | dsh 插件开发执行者（本规格的下一任实现者） |
| 交付目标 | 把"体感像 VS Code"的 V1 改造成 JetBrains 系 IDE（IntelliJ IDEA / WebStorm）的交互与观感 |

---

## 0. 如何使用本文档

1. **第 13 章的决策表是开工前提**：标 🔶 的项需要先做实现级验证（DSH 能力 / 性能 / 平台差异），标 ⬜ 的项需要产品负责人拍板。未定项不得动手写对应功能，可先用「默认方案」占位。
2. 决策状态标记沿用 V1：
   - ✅ 已定 —— 直接执行，不再讨论；
   - 🔶 待验证 —— 依赖 DSH 能力或性能实测，按第 13 章规则处理；
   - ⬜ 待拍板 —— 等产品负责人确认，实现时先用默认方案占位。
3. 术语沿用 V1 第 4 章（Git 原生术语 + JetBrains 框架术语），新增术语见 4.4。
4. 每个工具窗章节末尾有可验证的验收标准；完成即跑验收。
5. **范围控制**：第 12 章的「明确不做」优先级高于任何"顺手加上"的冲动。V2 的主要风险是功能面铺得过大，而非能力不足。

---

## 0.1 为什么要做 V2（V1 的体感诊断）

V1 交付了 Project / Commit / Terminal / Git 四窗与共享仓库模型，但交互模型是 **VS Code 的**：

| 维度 | V1 现状 | VS Code 对应 | JetBrains 期望 |
|---|---|---|---|
| 树点击 | 单击即打开（preview），双击固定 | Explorer 单击预览 | 单击选中、双击打开（可设置单击打开） |
| 树上文件操作 | 无（V1 明确不做） | 无（依赖 OS/命令） | 新建/重命名/移动/复制/删除，全部在树内完成 |
| 右键菜单 | 3 项，无快捷键标注 | 少量、无标注 | 大而全，每项右侧灰字快捷键 |
| Git 着色 | 蓝=修改、绿=新增/未跟踪 | SCM 着色 | 红=未跟踪、绿=已 add、蓝=修改，目录递归上色 |
| Commit 分组 | Staged / Unstaged / Unversioned 三组 | SCM 三段 | Changes / Unversioned 两组，勾选不移动 |
| Git 详情 | 详情 + diff 挤在编辑区标签 | SCM 视图 | 列表 + 底部详情面板，编辑区只放完整 diff |
| 布局 | 固定左条 + 底部 dock | 固定布局 | Docked / Floating / Split、Pin、Auto-hide、Stripe、Hide All |
| 通用 | 无命令面板、无状态栏细节、无多标签管理 | 命令面板 + 状态栏 | Search Everywhere、状态栏、标签右键管理 |

**V2 的核心命题：把「文件被点开」的心智换成「先选中、再操作」的 IDE 心智。**

---

## 0.2 与 V1 规格的覆盖关系（重要）

以下 V1 条款被 V2 **明确推翻**，执行时以本文档为准：

| V1 条款 | V2 处理 |
|---|---|
| 5.1「单击 = 预览标签，双击 = 固定」 | 改为：单击选中，双击打开；「单击打开 + 预览标签」降级为可选设置（默认关）。预览标签被编辑后自动转正式标签。 |
| 5.1「不做树内新建/重命名/删除（V2）」 | V2 做，并扩展为完整文件操作（含移动/复制/更新引用）。 |
| 5.2「三组：Staged / Unstaged / Unversioned」 | 改为两组：Changes / Unversioned，勾选表示"纳入提交"，不改变分组位置。 |
| 4.2「不要使用 Changelist」 | V2 引入 Changelist，作为**纯客户端**的分组视图（不改变 Git 语义），以对齐 IDEA。 |
| 3.1 固定左条 + 底部 dock 布局 | 改为三态工具窗 + Stripe + Pin/Auto-hide + Split + Floating。 |
| 5.4 详情 + diff 都在标签内容区 | 详情进 Git 工具窗底部面板，编辑区只放完整 diff。 |

以下 V1 能力**保留**（V2 不回退）：自建编辑器区与 Preview/Pinned 语义、行级/块级暂存、PTY 终端与 Windows UTF-8、路径围栏与同源准入、系统 git CLI、项目根选择器、主题令牌。

---

## 1. 产品定位

### 1.1 一句话

给 DSH 一套 **JetBrains 交互模型**的 IDE 工具窗：选中优先、操作齐全、快捷键可发现、布局可塑性高。

### 1.2 差异化（对内）

1. **"选中 → 操作"**：树、Commit 列表、Git 日志统一多选模型，所有批量操作共享同一套选择语义；
2. **快捷键可发现**：所有右键菜单右侧标注快捷键，操作在 右键 / 工具栏 / 快捷键 三处可达；
3. **布局拟态**：Docked / Floating / Split / Stripe / Pin / Auto-hide 六种形态，模拟 IDEA 工具窗；
4. **Git 着色与分组对齐 IDEA**：目录递归着色、勾选不移动分组、Changelist 组织。

### 1.3 非目标

不做语言服务（补全/检查/重构引擎）、不做 OS 级独立窗口、不做多人协作、不做远程开发。见第 12 章。

---

## 2. 设计原则（JetBrains 设计语言，通吃四区）

1. **选中优先**：单击只改变选择，不产生副作用；打开/提交等动作由双击、Enter 或显式按钮触发。
2. **快捷键可发现**：任何菜单项右侧有灰字快捷键；无快捷键的项不标注空格占位。
3. **入口冗余**：同一操作至少两处可达（右键 + 快捷键；重要操作再加工具栏按钮）。宁可冗余，不许隐藏。
4. **动作可撤销/可确认**：破坏性操作（删除、回滚、丢弃、检出 detached）必须二次确认并说明影响；能撤销的（重命名、移动）提供 Undo 入口。
5. **状态始终可见**：分支、改动数、光标位置、编码/换行符常驻状态栏；后台任务（刷新、查找）有进度指示。
6. **颜色即语义**：文件状态色、目录递归色、冲突角标、忽略/排除色为固定语义，不随皮肤漂移；所有色值走 `--dsw-alias-*` 令牌或插件语义变量。

---

## 3. 总体布局（工具窗体系）

### 3.1 工具窗三态 ✅

每个工具窗（Project / Commit / Terminal / Git）具备三种形态：

| 形态 | 行为 |
|---|---|
| **Docked（停靠）** | 停靠在左/右/下边缘之一，占据固定宽度/高度，与编辑区分栏，可拖拽分隔条调整尺寸。 |
| **Floating（浮动）** | 浮在编辑区之上的可拖动面板（**窗口内浮层**，非 OS 窗口），带标题栏、可拖动、可缩放、记忆位置。 |
| **Split（分屏）** | 同一停靠区（dock）内并排/上下放两个工具窗，分隔条可拖；标题栏右键 → Split Vertically / Split Horizontally。 |

> DSH 约束：宿主只有 `main` 整页槽，没有多窗口能力。三态均在插件自绘的工作台内部实现，语义对齐 IDEA 但物理上是同一页面。此偏差写入 README 的"与 JetBrains 的差异"。

### 3.2 标题栏与停靠 ✅

- 每个工具窗标题栏：图标 + 标题 + 右侧动作区（⚙ 设置入口、— 最小化、📌 Pin、⇤ Auto-hide、× 隐藏）。
- 拖标题栏：拖动到左/右/下边缘出现**高亮停靠提示**，松手重停靠；拖到编辑区中部 → 变为 Floating。
- 标题栏右键菜单：`Move to Left / Right / Bottom`、`Split Vertically / Horizontally`、`Float`、`Dock`、`Hide`。
- 停靠状态、Floating 位置/尺寸、Split 组合、左侧 dock 宽度、底部 dock 高度持久化到 settings（按工作区）。

### 3.3 Stripe（图标条）与 Auto-hide ✅

- 停靠区收起后只留边缘窄条（Stripe），显示该区内工具窗的图标 + 徽标。
- **悬停展开**：鼠标停在 stripe 图标上 ≥ 300ms，浮出该工具窗的临时面板（不占布局）；鼠标离开且未 Pin → 自动收回。
- **Pin**：常驻，不随失焦收回；`Auto-hide` 与 `Pin` 互斥（Pin 即关闭 auto-hide）。
- Stripe 支持左/右/下三条边；图标按启用顺序排列，可拖拽重排（V2.1）。

### 3.4 Hide All ✅

- `Ctrl+Shift+F12` 一键收起全部工具窗（记录收起前布局），再按一次恢复。
- 全屏时同样可用。

### 3.5 全屏 ✅

- 菜单 `View | Enter Full Screen`；快捷键 `F11`（工作台聚焦时拦截，优先 `document.documentElement.requestFullscreen()`，不可用时降级为工作台铺满可视区）。
- 全屏下 Stripe 仍可见，工具栏与状态栏保留。

### 3.6 状态栏 ✅

工作台底部常驻状态栏（工具窗占满主区时等价于 IDE 底栏）：

| 区段 | 内容 | 行为 |
|---|---|---|
| 左 1 | Git 状态点 + `Git` / `Not a Git repository` | 点击 → 打开 Commit |
| 左 2 | 当前分支（detached 时 `HEAD detached`） | 点击 → 打开 Git 窗口分支区 |
| 左 3 | `N 项改动` | 点击 → 打开 Commit |
| 中/右 | `Ln:Col`（当前文本标签光标位置） | 点击 → 聚焦编辑区 |
| 右 1 | 编码 + 换行符（如 `UTF-8 LF`） | 点击 → 只读弹层显示编码来源 |
| 右 2 | 通知铃铛（toast 历史，未读数） | 点击 → 通知列表 |
| 右 3 | 用户头像/首字母 | 点击 → DSH 账户设置（跳转宿主设置页） |

> `Ln:Col` 依赖编辑器光标事件；Markdown 渲染预览态无光标，显示空。

### 3.7 布局验收

- [ ] 每个工具窗可 Docked / Floating / Split 三态切换，重启后位置尺寸恢复；
- [ ] Stripe 悬停展开、失焦收回；Pin 后常驻；Auto-hide 与 Pin 状态互斥且持久化；
- [ ] `Ctrl+Shift+F12` 全部收起/恢复，期间编辑区不闪动、不丢标签；
- [ ] 拖标题到左/右/下边缘出现停靠高亮并正确重停靠；
- [ ] 状态栏五项数据实时正确（含 detached、非仓库、无标签打开三种空态）；
- [ ] 全屏可用 `F11` 进入/退出，全屏下工具窗与状态栏可用。

---

## 4. Project 工具窗

### 4.1 点击与选择模型 ✅

| 对象 | 单击 | 双击 | Enter | 右键 |
|---|---|---|---|---|
| 目录 | 选中（不展开） | 展开/折叠 | 展开/折叠 | 选中并弹出菜单 |
| 文件 | 选中（不打开） | 在编辑区打开（Pinned） | 打开（Pinned） | 选中并弹出菜单 |

- 展开/折叠仍可点 twisty（三角）或 `←/→`。
- **设置项**「Open files with single click」（默认关）：开启后，单击文件 = 打开为 **Preview Tab**（斜体）；该标签被编辑后自动转为正式标签（Pinned 语义）；未编辑时下一次单击替换它。
- 已打开的固定标签：再次双击/Enter → 聚焦该标签，不新建。
- 选中不改变编辑区内容；选中态用整行高亮（`--itw-selection`），失焦时保留选中但弱化。

### 4.2 多选与键盘 ✅

- `Ctrl+click` 切换单项选择；`Shift+click` 在锚点与目标之间按**可见行序**范围选择；`Ctrl+A` 全选可见行；`Esc` 清空选择。
- 多选驱动：批量删除/移动/复制、Compare、Rollback、Add to Favorites。
- 键盘（树聚焦时，见第 10 章总表）：`↑/↓` 移动焦点并单选、`←/→` 折叠/展开、`Enter` 打开、`F2` 重命名、`Delete` 删除、`F5` 复制、`F6` 移动、`Shift+F6` 重命名并更新引用、`Ctrl+D` 比较、`Ctrl+Alt+Y` 同步、`Ctrl+C/X/V` 复制/剪切/粘贴、`Alt+Shift+F` 收藏、`Ctrl+Shift+F` 在目录内查找。

### 4.3 拖拽 ✅

- 拖文件/目录到另一目录 = **移动**；按住 `Ctrl` = **复制**（拖动时显示 `+` 光标与提示）。
- 支持多选整体拖拽；拖到选中文件夹自身或其子树 = 禁止（显示 no-drop）。
- 拖到树空白区 = 移动到项目根。
- 目标目录短暂高亮；松手后异步执行，失败逐个报告。
- 名称冲突：弹窗 `Overwrite / Skip / Keep Both（自动加 -copy）`，批量应用可选"全部适用"。
- 拖拽期间自动展开悬停目录（500ms 延迟）。

### 4.4 文件操作 ✅ / 🔶

| 操作 | 快捷键 | 行为 | 状态 |
|---|---|---|---|
| 新建文件 | `Alt+Insert` | 弹出 New File 对话框（模板按类型），创建后打开并进入编辑态 | ✅ |
| 新建目录 | `Alt+Insert` → Directory | 内联命名 | ✅ |
| 重命名 | `F2` | 树内联编辑，校验非法字符/重名；成功后刷新树、更新打开标签路径与持久化状态 | ✅ |
| 删除 | `Delete` | 确认弹窗列出清单；默认移入回收站（见 13.2），关闭受影响的标签（脏标签先确认） | 🔶 |
| 复制（Duplicate） | `F5` | 同目录生成 `name-copy.ext` / `name-copy`，自动进入内联重命名 | ✅ |
| 移动 | `F6` | 目标目录选择器（或拖拽），可选"搜索引用" | ✅ |
| 重命名并更新引用 | `Shift+F6` | 弹窗：搜索范围（项目/目录/自定义）+ 预览命中列表 + 应用 | 🔶 文本级 best-effort |
| 剪切/复制/粘贴 | `Ctrl+X/C/V` | 树内剪贴板（多文件），粘贴到目标目录（跨目录移动/复制） | ✅ |
| 磁盘同步 | `Ctrl+Alt+Y` | 重新扫描文件树 + git status，保留展开与选中的既有节点 | ✅ |
| 复制路径 | 右键子菜单 | 绝对路径 / 相对路径 / 文件名；`Copy Reference`（`Ctrl+Alt+Shift+C`） | ✅ |
| 比较 | `Ctrl+D` | 选中两个文件 → 双栏 diff 标签；选中两个目录 → Compare Directories | ✅ |

**模板**：New File 提供常用模板（Java Class、Kotlin Class、TypeScript、JavaScript、Python、JSON、Markdown、HTML、CSS、Shell、`.gitignore`、空文件），模板内容保持最小、不带作者占位。

### 4.5 右键菜单（完整清单）✅

所有菜单项右侧展示灰字快捷键；无快捷键项留空。子菜单右侧带 `▸`。

**目录**

```
New ▸                     (Alt+Insert)
  File… / Directory… / 各类型模板
Cut                        Ctrl+X
Copy                       Ctrl+C
Paste                      Ctrl+V
Duplicate                  F5
Delete                     Delete
Rename                     F2
Copy Path/Reference ▸      Ctrl+Alt+Shift+C
  Absolute Path / Path from Content Root / Path from Repository Root / Filename
Find in Files…             Ctrl+Shift+F      （限定该目录）
Compare Directories…       Ctrl+D            （选中两个目录时可用）
Expand All / Collapse All
Synchronize                Ctrl+Alt+Y
Add to Favorites           Alt+Shift+F
Local History ▸
  Show History / Rollback / Put Label…
Git ▸
  Add / Show Diff / Show History / Rollback / Annotate
Open in Terminal
Open in Explorer
```

**文件**

```
Cut                        Ctrl+X
Copy                       Ctrl+C
Paste                      Ctrl+V
Duplicate                  F5
Delete                     Delete
Rename                     F2
Copy Path/Reference ▸      Ctrl+Alt+Shift+C
  Absolute Path / Path from Content Root / Path from Repository Root / Filename
Find Usages                Alt+F7            （🔶 无语言服务时为文本搜索，见 13.6）
Compare With ▸             Ctrl+D
  Clipboard Contents… / History Version… / Branch…
Override File Type ▸       （Mark as Plain Text 等，写 settings）
Add to Favorites           Alt+Shift+F
Local History ▸
  Show History / Rollback
Git ▸
  Add / Show Diff / Show History / Rollback / Annotate
Open in Terminal
Open in Explorer
```

**Analyze / Refactor 子菜单**：V2 **不提供语义能力**（无语言服务）。按 V1 的"缺失即隐藏"原则，这两组菜单项默认**不出现**；实现钩子预留（见 13.6），等 dsh 暴露语言服务后在 V2.2+ 开启。

### 4.6 颜色与 Git 状态 ✅

对齐 JetBrains 默认语义：

| 状态 | 文件行 | 目录（递归） | 说明 |
|---|---|---|---|
| Unversioned（未跟踪） | 红 | 含红文件 → 红 | 新增未 `git add` |
| Added（已 add，含新文件） | 绿 | 含绿文件 → 绿 | staged 新文件 |
| Modified（已跟踪有改动） | 蓝 | 含蓝文件 → 蓝 | 工作区与 index 均有改动均算 |
| Conflict | 红 + 冲突角标 | 红 + 角标 | 合并冲突 |
| Ignored（.gitignore 命中） | 文件名黄褐，正文灰 | 同名黄褐 | 默认**隐藏**，开关打开后显示 |
| Excluded（排除目录） | 名称 + 背景黄褐 | 同左 | 排除列表来自设置，不读 `.idea` |

- **目录递归着色**：由完整 status 快照一次遍历生成 `dir → 聚合状态` 映射（O(n)），不依赖已加载子节点，未展开的目录也能正确上色。优先级 ⬜ 待拍板：冲突 > 修改 > 新增 > 未跟踪（默认）。
- **冲突角标**：图标右下角红色 `!`；忽略文件不参与目录聚合。
- **状态徽标**：行尾保留 V1 的 `M/A/U` 小标记作为可选开关（默认关，避免与颜色重复）。

### 4.7 文件徽标与根图标 ✅

- **按类型图标**：沿用 V1 的 `fileTypeOf()` 分类并扩充 JetBrains 风格图标（Java 咖啡杯、KT、TS/JS、Python、Go、Rust、JSON、Markdown、SQL、Shell、图片、配置等）。
- **根类型四色图标**（目录图标着色）：Source 蓝 / Test 绿 / Resources 橙 / Generated 灰。判定规则（可被设置覆盖）：

  | 根类型 | 启发式 |
  |---|---|
  | Source | `src/main/java`、`src/main/kotlin`、`src`、`app`、`lib`（含源码文件的目录） |
  | Test | `src/test/*`、`test`、`tests`、`__tests__`、`*_test.*` 所在目录 |
  | Resources | `resources`、`assets`、`static`、`public`、`locales` |
  | Generated | `build`、`dist`、`out`、`target`、`generated`、`.next`（默认同时进入排除列表建议） |

- **VCS 角标叠加**：图标右下角小角标（冲突 `!`、未跟踪 `+`、已 add `✓`），与颜色冗余提示。
- **深浅主题双套**：图标以 `currentColor` + 语义色变量绘制（`--itw-icon-source` 等），由主题令牌解析出亮/暗两套观感；不为每个图标维护两份 SVG 文件。

### 4.8 搜索与过滤（树内）✅

- 面板头部搜索框：按名称过滤（保留 V1 能力），高亮命中片段，`Enter` 定位首个命中，`Esc` 清空。
- 头部开关：`Show Ignored`（默认关）、`Always Select Opened File`（默认开，编辑器切换时树自动展开并高亮）。

### 4.9 Project 验收

- [ ] 单击只选中；双击文件打开、双击目录展开；Enter 同双击；
- [ ] 开启"单击打开"后单击出 Preview Tab（斜体），编辑后转正式标签，再单击其他文件不替换已编辑标签；
- [ ] `Ctrl/Shift` 多选正确；`Ctrl+A` 全选；批量删除/移动/复制作用于整个选择；
- [ ] 拖拽移动、`Ctrl+拖拽` 复制、多选拖拽、拖入自身子树被拒；名称冲突弹窗正确；
- [ ] F2 内联重命名、F5 复制、F6 移动、Delete 确认删除、`Ctrl+X/C/V` 全部可用且更新打开标签；
- [ ] 右键菜单项齐全、快捷键灰字正确、不可用项正确置灰；
- [ ] 十万级文件仓库首屏 < 1s，展开/折叠无卡顿；改动后 ≤ 1s 树色更新；
- [ ] 目录递归着色在"未展开目录"上正确；忽略文件默认隐藏、开关后灰显；排除目录背景正确；
- [ ] 重启后展开状态、选中项、锚定侧、滚动位置恢复；
- [ ] 同目录/跨目录操作后 `git status` 与树状态一致（无幽灵条目）。

---

## 5. Commit 工具窗

### 5.1 分组与勾选 ✅

只保留两个分组：

```
▾ Changes                [✓全选] [Group by Directory ▾] [Rollback] [Refresh]
    [✓] src/app.ts        M   +12 −3
    [ ] docs/readme.md    M   +2 −0
▾ Unversioned Files      [✓全选]
    [✓] assets/new.png        U
```

- **分组规则**：`Changes` = 所有已跟踪且工作区/INDEX 有差异的文件；`Unversioned` = 未跟踪文件。
- **勾选语义**：勾选 = "纳入本次提交"；**文件不移动分组、不改变所在行**。
- **index 映射（实现层）**：勾选/取消勾选**立即**执行 index 操作，使复选框状态与 `git index` 保持一致：

  | 文件状态 | 勾选 | 取消勾选 |
  |---|---|---|
  | 已跟踪·修改（未暂存） | `git add -- <path>` | 无操作（保持工作区改动） |
  | 已跟踪·修改（已暂存） | 保持不变 | `git restore --staged -- <path>` |
  | 已跟踪·删除 | `git add -u -- <path>`（暂存删除） | `git restore --staged -- <path>` |
  | Conflict | 不可勾选（提示先解决冲突） | — |
  | Unversioned | `git add -- <path>` | `git rm --cached -- <path>`（回退为未跟踪） |

- 组头 checkbox 三态（全选/部分/全不选）；点击组头全选=对其所有可勾选项生效。
- 提交按钮可用条件：任意勾选文件存在，或勾选了 `Amend`。
- 侧条徽标 = `Changes + Unversioned` 文件总数（未提交改动总数）。

### 5.2 Changelist（变更列表）✅

对齐 IDEA 的分组视图，**纯客户端概念**，不影响 Git 索引语义：

- `Changes` 组内按 Changelist 分组：`Default`（默认，收容未归属文件）+ 用户自建列表。
- 文件右键：`Move to Changelist ▸ Default / New Changelist… / 已有列表`；支持把文件**拖拽**到另一个 Changelist 标题上。
- 切换当前 Changelist（标题右侧下拉）→ 列表按当前列表过滤（`Show All` 恢复全部）。
- 持久化：`settings.json` 的 `changelists: { "工作区路径": { active: "Default", lists: { "Default": [paths], "支付重构": [paths] } } }`；文件删除/重命名后自动清理与重映射。
- 提交范围 = 所有**勾选**文件（跨 Changelist），不因当前列表而截断；这与 IDEA"提交当前列表"不同，属简化决策，写入 README 差异说明。

### 5.3 Group by Directory ✅

- 组头下拉切换：`平铺` ⇄ `按目录分组`（目录树：目录节点带三态勾选，勾选目录 = 勾选其下可提交文件）。
- 目录分组下同样显示文件行、状态色与统计；目录节点的统计为其子树合计。
- 分组模式持久化（全局默认，不按工作区）。

### 5.4 文件操作与 Change View ✅

- **双击文件** → 编辑区打开 Change View（大尺寸差异视图），工具栏：
  - `Show Diff with ▾`：`Working Tree`（默认）/ `Last Revision`（HEAD 版本）/ `Latest`（上游分支版本）/ `特定分支…`；
  - `Jump to Source`（`F4` / `Ctrl+Enter`）：打开文件当前内容并定位；
  - `Revert`：丢弃该文件改动（确认弹窗，含文件名与 `+N −M`）；
  - `Side-by-Side / Unified` 切换；`Next/Previous Change`（`F7/Shift+F7`）。
- **单击文件** → 面板内联 diff 预览（列表下方可折叠预览区，高度可拖）。
- **未跟踪文件**：右键 `Add to .gitignore`（按路径追加，创建 `.gitignore` 若无）、`Remove from VCS`（对已跟踪文件执行 `git rm --cached`；未跟踪在 V2 语义下等价于忽略）、`Delete`；**支持预览内容**（文本 + 图片）。
- **工具栏**：`Rollback`（回滚勾选文件的改动，确认清单）、`Refresh`（刷新 status 与全部列表）。

### 5.5 提交面板 ✅

- 多行消息框 + 最近 10 条历史（时钟图标下拉，`Alt+↓` 展开）；`Ctrl+Enter` 提交。
- `Amend` 勾选；HEAD 为初始提交时禁用并提示。
- `Run Tests` / `Optimize Imports` / `Code Cleanup` 勾选：仅在**用户配置了对应命令**时显示（设置页 Git/Commit 分组），否则隐藏并在此分组显示"未配置命令"的说明入口。
- 双按钮 `Commit` / `Commit and Push`；提交成功 → 清空消息、刷新四窗；失败（hook 拒绝等）→ 错误输出内嵌展示，**消息与勾选保留**。
- `Ctrl+K` 打开本窗并聚焦消息框。

### 5.6 Commit 验收

- [ ] 勾选/取消任意文件后，`git diff --cached` 与复选框状态**严格一致**；行位置与分组不变；
- [ ] 组头三态全选正确；分组切换（平铺/目录）后勾选状态保持；
- [ ] Changelist 新建/移动/拖拽/切换/持久化正确，文件删除后自动清理；
- [ ] 双击文件出现 Change View，四种 `Show Diff with` 基线正确（与 CLI 对比）；
- [ ] 未跟踪文件可预览、可 Add to .gitignore、可删除；
- [ ] Rollback 二次确认并精确还原勾选文件；
- [ ] pre-commit hook 拒绝时消息与勾选保留、错误可见；
- [ ] `Commit and Push` 两阶段结果（commit 成功/push 失败）分别明确提示；
- [ ] 任意 git 操作后 ≤ 1s 分组、徽标与状态栏同步。

---

## 6. Git 工具窗

### 6.1 布局 ✅

```
┌ Git ────────────────────────────────────────────────────────────┐
│ [Log] [Local History]   ⌕搜索  作者▾  日期▾  分支▾  ☐仅结构性改动 │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ ◇ Graph │ SHA │ Subject │ Author │ Date                       ││
│ │ …                                                             ││
│ └──────────────────────────────────────────────────────────────┘│
│ ═══ 可拖分隔条 ═══                                                │
│ ┌ 提交详情（可折叠） ─────────────────────────────────────────┐ │
│ │ 作者/邮箱/时间/committer 时间 · Copy full/short hash         │ │
│ │ 父提交（可点击跳转）· refs 标签 · 完整消息                    │ │
│ │ 变更文件列表（图标/颜色） 单击=内联 diff 双击=全量 diff        │ │
│ │ [Show Diff with Parent] [with Working Tree] [Revert] …        │ │
│ └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

- 日志表与详情面板上下分栏（分隔条可拖、可折叠）；详情面板高度持久化。
- **编辑区只放完整 diff**：双击 commit 或详情里的文件 → 打开专门的全量 diff 标签（复用 DiffView，可继续展开文件/hunk）。V1 的"详情 + diff 挤在标签里"废弃。
- 窄宽（底部停靠 < 520px）自动切为"日志在上、详情抽屉"模式。

### 6.2 检索与过滤 ✅

| 过滤项 | 实现 |
|---|---|
| 关键字/哈希 | 顶部搜索框（`Ctrl+F` 聚焦）：`--grep` + 如果输入是 7–40 位十六进制则同时 `--all-match` 按哈希前缀匹配 |
| 作者 | 多选下拉（从 `git shortlog -sn` 取作者列表），传多个 `--author` |
| 日期范围 | 起止日期（`--since/--until`），快捷项：今天/最近 7 天/最近 30 天/自定义 |
| 分支 | 分支下拉（`--branch` 语义：当前分支历史 / 指定分支 / `--all`） |
| 路径 | Project 右键 `Git | Show History` → Git 窗打开并显示路径 chip（可 × 清除），传 `-- <path>` |
| 仅结构性改动 | 分页拉取时附加 `--numstat -w --ignore-blank-lines`；某 commit 无任何文件统计 → 判为纯格式/空行改动并隐藏（🔶 需实测大仓库开销，见 13.4） |

- 过滤条件任一变更 → 重置分页并重新拉取第 0 页；过滤态在"刷新/切分支"后保持。
- 过滤结果必须与 CLI 基线一致（验收项）。

### 6.3 提交详情面板 ✅

- 元信息：作者名 + 邮箱 + 头像（首字母色块）、author date 与 committer date、`Copy full hash` / `Copy short hash`、父提交可点击（单击选中该 commit，双击打开其 diff）、refs 标签（分支/标签/`origin/*`）、消息全文（保留换行）。
- 变更文件列表：状态图标 + 颜色（新增绿/修改蓝/删除红/重命名灰）、`+N −M`；**单击**在详情面板内联 diff 预览，**双击**打开全量 diff 标签。
- 操作按钮（带确认）：`Show Diff with Parent`、`Show Diff with Working Tree`、`Revert Commit`（`Ctrl+Alt+Z`）、`Cherry-pick`、`Checkout`（detached 确认）、`Create Branch…`、`Create Tag…`。
- 多选：`Ctrl+click` 选中两个 commit → 出现 `Compare`（`Ctrl+D`）；选中范围用于 Compare 时高亮两端。

### 6.4 Diff 查看器（V2 升级）✅

- `Side-by-Side` / `Unified` 切换（默认记住上次选择）。
- **单词级高亮**：在行内标记变化词元（token 级 diff），开关可关。
- **折叠未变更大段**：超过 20 行的未改动块默认折叠为 `⋯ N lines`；可"展开全部/折叠全部/展开该块"；文件级全部折叠/展开。
- 行号槽：新增/删除箭头（`▸` 折叠控件），`+N −N` 统计，空白差异（仅空格）弱化显示。
- 二进制/图片：提示"binary file"或渲染图片对比（新增/删除/替换）。
- 性能：单文件 diff 渲染 < 300ms（1 万行文件），单词级高亮仅对可见行计算。

### 6.5 分支拓扑 ✅

- 保留 V1 的 lane 图（彩色分支线、合并圆点、标签锚点），V2 增强：
  - 分支颜色稳定（按分支名哈希取色，切换排序不换色）；
  - 合并提交画出双父连线；
  - refs 锚点可点击（切分支/检出标签）；
  - 悬停节点显示完整 subject 与时间。
- 复杂拓扑退化为线性时**不得错画**（宁可少画不可错画，V1 规则保留）。

### 6.6 Local History（本地历史）✅ / 🔶

- 独立的"本地历史"视图（Git 窗内的 `Local History` 页签 + Project 右键入口）。
- 数据源：插件自身快照（每次通过本插件保存文件时写入 + Ctrl+Alt+Y 同步时对变更文件补快照），存于 `%DSH_HOME%/ide-toolwindows/local-history/<工作区哈希>/`，内容按 SHA-256 去重压缩存储。
- 时间线：时间、触发来源（保存/同步/回滚前）、大小、`+N −M`；选两条 → diff；`Rollback`（先把当前内容存为新快照，再写回目标版本）。
- 目录历史：聚合其下文件的快照时间线（按时间合并）。
- 保留策略 🔶：每文件最多 100 条 / 工作区总量上限 200 MB / 90 天，超出按最旧优先清理；设置页可调。

### 6.7 Git 验收

- [ ] 200 条日志首屏 < 1s；分页追加无重复无遗漏；
- [ ] 关键字/哈希/作者多选/日期/分支/路径/结构性改动过滤均与 CLI 基线一致；
- [ ] 详情面板元信息完整，父提交可跳转，复制 hash 正确；
- [ ] 单击文件内联 diff < 300ms，双击打开全量 diff；
- [ ] 双 commit Compare（`Ctrl+D`）与分支 Compare 结果正确，单词级高亮可开关；
- [ ] 未变更块默认折叠、可逐块/全部展开；
- [ ] Revert / Cherry-pick / Checkout / Create Branch/Tag 均二次确认且结果正确；
- [ ] 检出历史 commit 后四窗同步刷新（GitEventBus 等价路径）；
- [ ] Local History 保存后立即出现在时间线，回滚精确还原，超限清理生效。

---

## 7. 编辑器区与标签

### 7.1 预览与固定 ✅

- Preview Tab：斜体名称、无固定标记；被编辑 → 自动转正式（去掉斜体、标记 dirty）；`Ctrl+S` 保存后仍是正式标签；关闭时若未编辑直接关，已编辑则走未保存确认。
- 「Open files with single click」默认关（见 4.1）；开启后单击用 Preview，双击/Enter 用正式。
- 已固定标签被单击（树）→ 只聚焦，不替换。

### 7.2 标签管理（V2.2）✅

- 标签右键：`Close`（`Ctrl+F4`）、`Close Others`、`Close All`、`Close Tabs to the Right`、`Copy Path`、`Reveal in Project`、`Split Right` / `Split Down`、`Pin Tab` / `Unpin Tab`、`Set Color ▸`（红/黄/绿/蓝/紫，仅视觉）、`Move to Changelist`（若为改动文件）。
- 分裂视图：编辑区左右/上下两组标签（各自独立激活），分隔条可拖；关闭一组时组内标签回落到另一组。
- 未保存标记 `●`（橙色圆点）与"未提交改动"标记（文件名后小圆点，颜色=git 状态）同时存在时，用 `● + 色点` 双标记区分。
- 标签条溢出：横向滚动 + 滚筒菜单（`⌄` 列出全部打开标签）。

### 7.3 标签验收

- [ ] 预览标签复用/转正/关闭三条路径正确；
- [ ] Close Others/All/Right 行为正确（脏标签逐个确认，可"全部不保存"）；
- [ ] 左右/上下分裂可创建、可拖分隔条、可关闭单组；
- [ ] 颜色标签持久化（按路径记忆），刷新后恢复；
- [ ] 标签溢出时滚筒菜单可跳转任意标签。

---

## 8. 通用设计语言落地

### 8.1 菜单规范 ✅

- 统一 `ContextMenu` 组件：图标列 + 文本 + 右侧灰字快捷键列 + 子菜单箭头；分隔线分组；禁用项灰显且不响应；菜单最大高度内滚动（超 12 项）。
- 快捷键字符串来自 settings（可重绑后菜单实时更新），不允许写死显示值。
- 菜单在窗口边缘自动翻转，不超出可视区。

### 8.2 冗余入口矩阵 ✅

| 操作 | 右键 | 工具栏 | 快捷键 |
|---|---|---|---|
| 新建 | ✓ | ✓（Project 头部 `+`） | ✓ |
| 重命名 | ✓ | — | ✓ |
| 删除 | ✓ | — | ✓ |
| 移动 | ✓ | — | ✓ |
| 复制 Duplicate | ✓ | — | ✓ |
| 同步 | ✓ | ✓ | ✓ |
| 比较 | ✓ | — | ✓ |
| 收藏 | ✓ | — | ✓ |
| 本地历史 | ✓ | ✓（Git 窗页签） | — |
| 提交/Rollback/刷新 | ✓ | ✓ | ✓（提交） |
| 回滚改动 | ✓ | ✓ | — |

### 8.3 Search Everywhere（V2.2，预留）✅

- `Ctrl+Shift+A` 或双击 `Shift`（400ms 内两次）打开命令面板：模糊匹配所有已注册命令（名称 + 快捷键），`Enter` 执行、`Esc` 关闭；后续扩展为文件/符号搜索。
- 命令注册表与右键菜单共用一份 action registry，保证"菜单有、面板就有"。

### 8.4 主题与颜色 ✅

- 所有颜色经 `--itw-*` 语义变量映射到 `--dsw-alias-*`；新增语义色：`--itw-git-untracked / added / modified / ignored / excluded / conflict`，亮暗主题各自解析。
- 深色主题下降低色彩饱和度（JetBrains Darcula 观感），浅色主题用 IntelliJ Light 色值；两者都通过令牌覆盖，不在组件内写死。
- 图标随 `currentColor` 与语义色变量自动适配，无独立图片切换逻辑。

---

## 9. 共享服务与数据模型

### 9.1 服务拆分（在 V1 RepositoryService 之外新增）

```
Host
 ├ RepositoryService（扩展）  status(含 ignored/conflict/聚合色) / log(过滤) / diff(ref,ref) / blame / checkout / revert / cherry-pick / branch|tag
 ├ FileOpsService（新）        create / rename / duplicate / move / copy / delete / reference-search
 ├ LocalHistoryService（新）   snapshot / timeline / diff / rollback / prune
 ├ SearchService（新）         findInFiles（目录范围，流式结果，可取消）
 └ SettingsStore（扩展）       schema v2 + 迁移 + changelists/favorites/layout/fileTypes/excluded
Client
 ├ WorkbenchStore（扩展）      selection / layout / changelists / tabs / actions
 ├ ActionRegistry（新）        命令 id + 标题 + 快捷键 + 可用性谓词 + 执行体（菜单/面板共用）
 └ LayoutEngine（新）          三态、停靠、分割、浮层、stripe、pin/autohide
```

### 9.2 API 新增（`/ide-toolwindows/api/<method>`）

| 分组 | 方法 |
|---|---|
| fs | `fs.create`、`fs.rename`、`fs.duplicate`、`fs.move`、`fs.copy`、`fs.delete`、`fs.search`（内容查找）、`fs.references`（文本级引用搜索） |
| history | `history.snapshot`、`history.timeline`、`history.diff`、`history.rollback`、`history.prune` |
| git | `git.blame`、`git.diffRefs`、`git.cherryPick`、`git.createBranch`、`git.createTag`、`git.ignore`（追加 .gitignore）、`git.checkIgnore`、`git.structuralLog` |
| workspace | `workspace.excluded`（读写排除列表）、`workspace.aggregateStatus`（若服务端聚合） |
| settings | `settings.migrate`（v1→v2） |

所有新方法沿用 V1 契约：POST + JSON、Connection 围栏、路径围栏（`resolveInside`）、错误用 `ApiError { code, message }`。

### 9.3 设置 schema v2

```
{
  "version": 2,
  "shortcuts": { ...V1 六个, "synchronize": "Ctrl+Alt+Y", "compare": "Ctrl+D", "findInFiles": "Ctrl+Shift+F",
                  "delete": "Delete", "rename": "F2", "renameRefs": "Shift+F6", "duplicate": "F5", "move": "F6",
                  "favorite": "Alt+Shift+F", "hideAll": "Ctrl+Shift+F12", "searchEverywhere": "Ctrl+Shift+A",
                  "revertCommit": "Ctrl+Alt+Z", "openFile": "Enter", "jumpToSource": "F4" },
  "project": { "singleClickOpen": false, "alwaysSelectOpened": true, "showIgnored": false, "excluded": [], "fileTypes": {} },
  "git": { "path": "", "diffStyle": "side", "structuralOnly": false, "logPageSize": 200 },
  "commit": { "groupByDirectory": false, "testCommand": "", "cleanupCommand": "", "optimizeImportsCommand": "" },
  "layout": { "tools": { "project": { "dock": "left", "mode": "docked", "pinned": true, "autoHide": false, "width": 300 },
                          "commit": {...}, "terminal": {...}, "git": {...} }, "floating": {}, "split": {} },
  "favorites": [],
  "changelists": { "<workspace>": { "active": "Default", "lists": {} } },
  "history": { "maxPerFile": 100, "maxBytes": 209715200, "maxDays": 90 },
  "delete": { "useRecycleBin": true, "confirm": true },
  "ui": { "showStatusBar": true, "locale": "auto" }
}
```

- 迁移：读 v1 时按字段合并、`version` 置 2；未知字段保留（forward-compatible）；迁移失败不丢原文件（写 `.bak`）。

### 9.4 性能预算

| 场景 | 预算 |
|---|---|
| 万级文件树首屏 / 目录递归着色 | < 1s / 状态刷新后着色更新 < 100ms |
| 树内文件操作（rename/move/duplicate） | 本地 < 200ms 反馈，异步完成刷新 |
| Find in Files（10k 文件） | 首屏结果 < 500ms，全量 < 2s，可取消 |
| Git 日志 200 条 + 图 | < 1s；结构性过滤额外 ≤ 300ms/页 |
| diff 渲染 / 单词级高亮 | < 300ms / 仅可见行，< 100ms |
| 本地历史快照写入 | 保存路径异步，主线程 0ms 阻塞 |
| commit 勾选切换 | 乐观 UI 立即生效，index 操作后台完成（失败回滚勾选并 toast） |

### 9.5 测试扩展

- 单测新增：文件操作（含编码保持、冲突、越界）、目录聚合着色、changelist 持久化与清理、引用搜索、本地历史快照/回滚/清理、log 过滤参数拼装、word-level diff 与折叠块、菜单快捷键渲染、布局状态持久化。
- SSR 渲染测试新增：右键菜单（含禁用/快捷键灰字）、Commit 勾选模型、Git 详情面板、Stripe/浮层/分割布局、状态栏各状态。
- 真实 git 集成测试：勾选→index 一致性、compare 两 commit、结构性过滤、checkout/revert/cherry-pick 后状态同步。

---

## 10. 快捷键总表

| 上下文 | 快捷键 | 动作 |
|---|---|---|
| 全局（工作台聚焦） | `Alt+1` | Project 显示/聚焦 |
| | `Alt+0` | Commit 显示/聚焦 |
| | `Alt+9` | Git 显示/聚焦 |
| | `Alt+F12` | Terminal 显示/聚焦 |
| | `Ctrl+K` | Commit + 聚焦消息框 |
| | `Ctrl+Shift+K` | Push |
| | `Ctrl+Shift+F12` | Hide All |
| | `F11` | 全屏切换 |
| | `Ctrl+Shift+A` / 双击 `Shift` | Search Everywhere（V2.2） |
| Project 树 | `↑/↓` | 移动焦点 |
| | `←/→` | 折叠 / 展开 |
| | `Enter` | 打开文件 / 展开目录 |
| | `F2` / `Shift+F6` | 重命名 / 重命名并更新引用 |
| | `Delete` | 删除 |
| | `F5` | 复制 Duplicate |
| | `F6` | 移动 |
| | `Ctrl+X/C/V` | 剪切/复制/粘贴 |
| | `Ctrl+D` | 比较（两选中） |
| | `Ctrl+Shift+F` | 在选中目录内查找 |
| | `Ctrl+Alt+Y` | Synchronize |
| | `Alt+Shift+F` | Add to Favorites |
| | `Ctrl+Alt+Shift+C` | Copy Reference |
| Commit | `Ctrl+Enter` | 提交 |
| | `Alt+↓` | 提交消息历史 |
| Change View / Diff | `F4` / `Ctrl+Enter` | Jump to Source |
| | `F7` / `Shift+F7` | 下一个/上一个改动 |
| Git | `Ctrl+F` | 聚焦日志搜索 |
| | `Ctrl+D` | Compare 选中提交 |
| | `Ctrl+Alt+Z` | Revert Commit |

**冲突策略**：工作台根节点用 capture 阶段 `keydown` 处理并 `preventDefault`，仅在焦点位于工作台内（或工作台是活动面板）时拦截；拦截清单（F5、F11、Ctrl+D、Ctrl+Shift+A、Ctrl+Shift+F12 等浏览器保留键）写入设置页"快捷键冲突"说明；任何未绑定快捷键不进菜单。

---

## 11. 国际化

- 所有新增文案进入 `locale/en.json` 与 `locale/zh.json`，key 按 `project.* / commit.* / git.* / layout.* / menu.* / status.* / history.* / search.*` 命名。
- 快捷键显示名不翻译（`Ctrl+Alt+Y`）。
- 菜单项与工具栏 tooltip 必须同时有 en/zh；缺失 key 时回退 en 并记录开发期告警。

---

## 12. 范围外（V2 明确不做）

1. 语言服务类能力：补全、检查（Inspect Code）、语义重构（Refactor 子菜单）、Find Usages 语义版、Optimize Imports/Code Cleanup 的内置实现（只允许"用户配置命令"模式）；
2. OS 级独立浮动窗口、多显示器窗口管理；
3. 远程开发、SSH、容器内开发；
4. 多人协作、冲突三路合并可视化编辑器（冲突仍只在 Commit 窗标红并提示 CLI 处理）；
5. stash、fetch/pull、交互式 rebase、blame 行内 gutter（V2 只做 Annotate 视图，行内 gutter 进 V3）；
6. 文件树内"在磁盘外新建"、符号链接特殊处理、权限编辑；
7. Replace in Files（只做 Find）；
8. 插件商店素材与发布流程（沿用 V1 M5，另行安排）。

---

## 13. 待验证 / 待拍板清单（开工前必须回填）

### 13.1 决策回填表

| # | 决策项 | 默认方案 | 结论 |
|---|---|---|---|
| 1 | 删除实现 | Windows 回收站优先（PowerShell 调 VisualBasic FileSystem），失败降级永久删除并在确认框明示 | ✅ 已定（2026-10-22） |
| 2 | 目录递归着色优先级 | 冲突 > 修改 > 新增 > 未跟踪 | ✅ 已定（2026-10-22） |
| 3 | Shift+F6 引用更新 | 文本级搜索替换（按文件类型白名单，排除二进制与忽略目录），带预览与取消 | 🔶 待验证 |
| 4 | 结构性过滤实现 | `git log --numstat -w --ignore-blank-lines` 单次分页；无文件统计的 commit 视为纯格式 | 🔶 待性能实测 |
| 5 | Run Tests / Code Cleanup | 用户配置命令；未配置时隐藏 | ✅ 已定（2026-10-22） |
| 6 | Find Usages | 文本搜索并在结果中标注「文本匹配」（无语言服务），菜单项保留（`Alt+F7`） | ✅ 已定（2026-10-22） |
| 7 | Floating 语义 | 窗口内浮层，非 OS 窗口（README 明示差异） | ✅ 已定 |
| 8 | Changelist 提交范围 | 提交所有勾选文件（跨列表），非"仅当前列表" | ✅ 已定（2026-10-22） |
| 9 | 状态栏 `Ln:Col` | 仅文本编辑态显示；Markdown 预览态留空 | ✅ 已定 |
| 10 | 本地历史触发 | 插件保存 + 手动同步；不做后台文件监听 | ✅ 已定 |
| 11 | 文件搜索后端 | 仓库内优先 `git grep`，非仓库/无 git 时自实现遍历（尊重忽略与排除） | 🔶 待验证 |
| 12 | 图标方案 | 单套矢量 + 主题语义色变量（不维护双份 SVG） | ✅ 已定 |

> **决策锁定记录**：2026-10-22，产品负责人确认 13.1 全部 ⬜ 项采用上述默认方案；🔶 项在实现对应功能时验证后回填。

### 13.2 平台验证项

- Windows 回收站删除 API 可用性与失败回退；
- `F11` 在 Desktop 内嵌 WebView 中的 `requestFullscreen` 行为；
- 浏览器保留键（F5/F11/Ctrl+D/Ctrl+Shift+A）在 WebView 与浏览器中的拦截一致性；
- 大量小文件（>5 万）下目录聚合着色的内存与耗时；
- 10k 文件 Find in Files 的取消与流式渲染；
- 浮层在宿主页面缩放/DPI 变化下的定位稳定性。

---

## 14. 里程碑

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| **V2.0 交互基座** | 选择模型 + 多选 + 拖拽 + 全部文件操作 + 右键菜单（快捷键标注）+ Project 着色/图标 + Commit 两组勾选 + 布局三态/Stripe/Pin/Auto-hide/Hide All/全屏 + 状态栏 + settings v2 迁移 | 第 4、5、3 章验收全过，可日常替代 V1 |
| **V2.1 Git 工作流** | Changelist + Group by Directory + Change View + Git 详情底部面板 + 全部过滤 + Compare + 单词级 diff/折叠 + Local History + Git 右键操作 + Annotate | 第 6 章验收全过 |
| **V2.2 IDE 增强** | Find in Files + Compare Directories + Favorites + 标签分裂/颜色/滚筒 + Search Everywhere + 根类型图标 + 文件类型覆写 + Jump to Source | 第 7、8 章验收全过 |

顺序约束：V2.0 先于 V2.1（选择/布局/文件操作是其他功能的地基）；V2.2 可与 V2.1 局部并行。

---

## 15. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 功能面过大导致交付周期失控 | 高 | 严格按里程碑；每个里程碑结束即发布自用版本；新需求进 V3 backlog |
| 浏览器/WebView 保留键拦截失败 | 中 | 捕获阶段 + `preventDefault` + 设置页冲突提示 + 可重绑 |
| Floating/Split 自绘布局在窄窗口下错位 | 中 | 布局状态用相对单位 + 边界钳制 + 每次切换做可视区约束 |
| Local History 存储膨胀 | 中 | 内容去重 + 上限 + 自动清理 + 设置可调 |
| 文本级 Shift+F6 误改 | 中 | 预览命中 + 类型白名单 + 可取消 + 操作前自动快照 |
| 目录递归着色性能 | 中 | 单次 O(n) 聚合 + 增量更新 + 定时器节流 |
| 与 DSH 自带 sidebar/快捷键冲突 | 低 | 仅在 workbench 活动时拦截；README 专节说明 |

---

## 16. V3 Backlog

> 2026-10-22 调整：V2.1 只保留到「单词级高亮 + 未变更块折叠」。以下原 V2.1 条目
> 全部移入 V3：Local History（本地快照/时间线/回滚）、分支右键 Compare、Cherry-pick、
> Create Branch/Tag、Annotate/Blame 视图，以及 Floating/Split 三态布局。

语义重构/检查（等语言服务）、行内 blame gutter、Replace in Files、stash、fetch/pull、交互式 rebase、三路合并编辑器、分屏终端、远程开发、插件商店上架素材、Local History、分支 Compare、Cherry-pick、Create Branch/Tag、Annotate/Blame、Floating/Split 工具窗。
