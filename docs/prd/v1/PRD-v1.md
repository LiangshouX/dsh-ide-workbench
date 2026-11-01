# dsh-ide-toolwindows — dsh IDE 式工具窗插件 · 产品规格说明书

| | |
|---|---|
| 版本 | v0.2（精修版） |
| 状态 | 待 M0 调研回填可行性 |
| 目标读者 | **dsh（DeepSeek Harness Desktop）插件开发执行者** |
| 交付目标 | 先个人自用，验证顺手后上架 dsh 插件社区 |
| 插件结构 | 单插件，内含 4 个工具窗（Tool Window） |

---

## 0. 如何使用本文档（写给执行者）

1. **先读第 7 章 M0 调研清单**，逐项验证 dsh 插件 API 能力，把结论回填到 7.2 的决策表，再开始编码。M0 未完成前不要动手写功能代码。
2. 文档中所有 **「决策状态」** 标记含义：
   - ✅ 已定 —— 直接执行，不要重新讨论；
   - 🔶 待 M0 —— 依赖 dsh API 能力，按第 7 章的决策规则处理；
   - ⬜ 待拍板 —— 等产品负责人（人）确认，实现时先用「默认方案」占位。
3. 术语以第 4 章为准，UI 文案不得自造同义词。
4. 每个工具窗章节末尾有**可验证的验收标准**，完成即跑验收。
5. 「明确不做」清单优先级高于任何「顺手加上」的冲动——范围蔓延是本项目最大风险。

---

## 1. 产品概述

### 1.1 背景与痛点

dsh 官方 sidebar 与社区高星插件 dsh-better-sidebar 的文件浏览模型为：

- 文件树**孤立渲染**，与编辑器无联动（无反向定位、无改动着色）；
- 点击文件 → 内容进入**一个全新的独立标签页**，没有 IDEA 的「预览标签」概念；
- 无 Commit / Terminal / Git 历史的统一工具窗体系，快捷键流断裂。

对长期使用 JetBrains IDE 的用户，这套交互完全无法形成肌肉记忆。dsh 插件社区中无同类产品。

### 1.2 产品定位（一句话）

为 DeepSeek Harness Desktop 提供一套 JetBrains 式的工具窗体系——**Project / Commit / Terminal / Git** 四窗共享同一份仓库状态，让 IDEA 用户在 dsh 中找回键盘驱动的 IDE 工作流。

### 1.3 差异化要点（对内，不要写进商店文案）

1. **预览标签（Preview Tab）**：文件树单击 → 所有单击复用同一个未固定标签轮换展示，双击才固定为普通标签；
2. **四窗联动**：Project 树上的改动着色、Commit 侧条徽标、Git 日志自动刷新，全部来自同一个 `RepositoryService` + `GitEventBus`；
3. **完整快捷键体系**：Alt+1 / Alt+0 / Alt+9 / Alt+F12 / Ctrl+K / Ctrl+Shift+K，对齐 IDEA。

### 1.4 商店一句话（上架时用）

> JetBrains-style tool windows: Project, Commit, Terminal, Git.

---

## 2. 命名方案

| 项 | 值 | 决策状态 |
|---|---|---|
| 插件正式名（仓库名 / ID） | **dsh-ide-toolwindows** | ✅ 已定 |
| 显示名（商店展示） | **IDE Tool Windows** | ✅ 已定 |
| 插件 ID | `dsh-ide-toolwindows`（生态惯例为 `dsh-` 前缀 + 仓库名；若 dsh 官方 ID 规范另有要求则从其规定，仅调整形式不改核心名） | 🔶 待 M0（仅规范形式） |
| 包名 / 目录名占位 | `ide.toolwindows` | ✅ 已定 |
| 设置页自称 | Tool Windows Settings | ✅ 已定 |

> **命名演进记录（供执行者理解语义，勿再重开讨论）**：v0.1 曾定名 Workbench，因第三方插件 dsh-workbench 已占用该名且口碑差而否决；随后评估 JetBrains 式单词隐喻（Squire / Flank / Cockpit 等）与 `jetbrains-style`（商标风险）均否决；最终采用描述性复合名。命名三层分工：插件 ID（搜索与仓库标识）、显示名（商店展示）、商店副标题（功能全称描述，见 1.4）。

**四个工具窗的显示名直接沿用 JetBrains 原名，不翻译、不自造**——学习成本为零是核心收益：

| 工具窗 | 显示名 | 默认快捷键 | 侧条（Stripe）图标语义 |
|---|---|---|---|
| 文件树 | **Project** | `Alt+1` | 目录树 |
| 提交 | **Commit** | `Alt+0` | 对勾 + 分支（IDEA 同款语义） |
| 终端 | **Terminal** | `Alt+F12` | `>_` |
| 历史 | **Git** | `Alt+9` | 分支节点线 |

辅助快捷键（对齐 IDEA）：

| 快捷键 | 行为 |
|---|---|
| `Ctrl+K` | 打开 Commit 窗并聚焦提交消息框 |
| `Ctrl+Shift+K` | Push |
| `Shift+Shift` | Find Action / 文件（V2 可选项，V1 不做） |

---

## 3. 系统架构规格（横切）

### 3.1 共享服务层（架构重点，先于功能实现）

```
┌─────────────────────────────────────────────────┐
│            dsh-ide-toolwindows 插件               │
│                                                   │
│  RepositoryService ──► GitEventBus ──┬──► Project（树着色）│
│   · 仓库检测/单仓(接口预留多仓数组)      ├──► Commit（徽标/列表）│
│   · file → repo 昱射                  └──► Git（日志刷新）   │
│   · HEAD/branch/status 缓存                          │
│                                                   │
│  SettingsStore（i18n / 快捷键 / shell / git 路径）      │
└─────────────────────────────────────────────────┘
```

- **Git 操作实现策略：直接调用系统 `git` CLI**（子进程），不用 nodegit/libgit2。理由：实现简单可靠、免费继承用户已有的 credential 配置。✅ 已定
- `GitEventBus` 触发源：文件监听（dsh 提供则复用，否则轮询降级）+ 任何 git 操作完成后的主动失效广播。广播必须异步，订阅方自行节流。
- 所有 git 命令与文件 IO 不得阻塞 UI 线程。

### 3.2 快捷键冲突处理

- 首次启动检测 `Alt+1/0/9/F12`、`Ctrl+K`、`Ctrl+Shift+K` 与 dsh 自身快捷键的冲突；
- 冲突 → 设置页高亮 + 一次性提示，**必须支持重绑**。

### 3.3 设置页（Tool Windows Settings）

| 分组 | 设置项 |
|---|---|
| 快捷键 | 六个快捷键重绑 |
| 终端 | 默认 Shell Profile、新会话 cwd 策略（项目根 / 当前文件目录） |
| 文件树 | 始终选择打开的文件（默认开）、Git 着色开关 |
| Git | `git` 可执行路径（默认取 PATH）、提交消息模板 |
| 外观 | 主题跟随 dsh / 独立、界面语言（en / zh-CN） |

### 3.4 国际化

- **第一天就抽 i18n key**（后补成本极高），上架前补全 zh-CN；
- en 为权威文案源，中文译名见第 4 章术语表。

### 3.5 统一错误态 / 空态规范

每个工具窗必须实现以下状态，**用空态面板 + 引导/重试按钮，禁止弹原始异常**：

| 状态 | Project | Commit | Terminal | Git |
|---|---|---|---|---|
| 非 Git 仓库 | 正常（无着色） | 空态：`Not a Git repository` | 正常 | 空态引导 |
| git 未安装/路径错 | 正常 | 设置引导 | 正常 | 设置引导 |
| detached HEAD | 正常 | 正常（提交消息区提示） | 正常 | 顶部显示 `HEAD detached` |
| 认证失败（push/pull） | — | 操作结果通知 + 重试 | — | 同左 |
| PTY 启动失败 | — | — | 错误面板 + 选择其他 Profile | — |

### 3.6 性能预算

| 场景 | 预算 |
|---|---|
| 万级文件仓库：Project 树首屏 | < 1s，展开/折叠无卡顿（虚拟滚动） |
| 选中文件 → Diff 渲染 | < 300ms |
| Git 日志首屏（200 条） | < 1s，滚动追加分页 |
| git 命令对 UI 的阻塞 | 0ms（全部异步） |

---

## 4. 术语表（UI 文案规范）

> en 为权威文案，zh 为建议译法。**禁止自造同义词**。

### 4.1 框架术语

| English | 中文 | 说明 |
|---|---|---|
| Tool Window | 工具窗口 | 四个面板的统称，文档与设置统一用此词 |
| Tool Window Stripe | 工具窗口侧条 | 屏幕边缘那排图标按钮 |
| Anchor (Left/Right) | 锚定（左/右） | 工具窗停靠侧；若 dsh 不支持浮动/自动隐藏，则该概念从规格中删除 |
| Content | 内容区 | 工具窗标题栏以下的主体 |
| Preview Tab | 预览标签 | 单击文件时复用的未固定标签，文件名斜体显示（IDEA 行为） |
| Pinned / Unpinned | 固定 / 未固定 | 双击固定；固定标签不被后续单击替换 |
| Badge | 徽标 | 侧条按钮上的数字（Commit 未暂存文件数、Terminal 会话数） |

### 4.2 Git 术语（关键决策：用 Git 原生术语，不用 IDEA 私有抽象）

> ⚠️ **不要使用 Changelist（变更列表）**——那是 IDEA 私有概念；dsh 用户是 Git 原生心智，实现上也直接映射 index。

| English | 中文 | 说明 |
|---|---|---|
| Staged Changes | 已暂存的改动 | Commit 窗分组名 |
| Unstaged Changes | 未暂存的改动 | Commit 窗分组名 |
| Unversioned Files | 未版本控制的文件 | 即 untracked |
| Stage / Unstage | 暂存 / 取消暂存 | |
| Discard | 丢弃 | 危险操作，必须二次确认。**禁止叫 Revert**（Revert 专指对 commit 的逆向提交，见下） |
| Diff / Hunk / Line-level staging | 差异 / 块 / 行级暂存 | gutter 选中行 → Stage Selection；选中块 → Stage Hunk |
| Amend | 修订提交 | 勾选后将改动并入上一次 commit |
| Revert (commit) | 还原提交 | Git 窗右键，生成逆向 commit |
| Checkout / Switch | 检出 / 切换 | Git 窗切换分支或进入 detached |
| Cherry-pick | 摘取提交 | V1 仅出现在右键菜单（可禁用），操作放 V2 |
| Upstream | 上游 | push/pull 的目标引用 |
| HEAD | HEAD | 不翻译 |
| Commit Graph | 提交图谱 | Git 窗节点连线渲染 |
| SHA / Short SHA | 提交号 | 列显示 7 位短 SHA，右键 Copy Full SHA |

### 4.3 终端术语

| English | 中文 | 说明 |
|---|---|---|
| Session | 会话 | 一个 PTY 进程；Tab 显示 `shell @ 目录名` |
| Shell Profile | Shell 配置 | Windows：PowerShell / CMD / Git Bash；macOS：zsh / bash |
| cwd (Working Directory) | 工作目录 | 新会话默认 = 项目根 |
| Split | 分屏 | V1 不做，术语预留 |

---

## 5. 功能规格

### 5.1 Project 工具窗（Alt+1）

**目标**：IDEA 式文件浏览——预览优先、反向定位、改动着色。

#### 范围内（V1）

1. **树渲染**：项目根 → 目录/文件树，按扩展名显示文件图标；
   - **Git 着色**：蓝 = Modified，绿 = Added/Untracked，红 = Conflict；数据源复用 `RepositoryService` 的 git status；
   - 状态持久化：展开路径、滚动位置、锚定侧，重启恢复。
2. **打开语义（核心交互）**：
   - 单击文件 → 打开 **Preview Tab**（若已有 Preview Tab 则复用替换，编辑器标签总数不随单击增长）；
   - 双击文件 → 固定为普通标签（Pinned）；
   - 单击的文件已是固定标签 → 直接聚焦该标签，不产生新标签。
3. **反向定位**：编辑器切换文件时，树自动展开并高亮对应节点（开关「Always Select Opened File」，默认开）。
4. **右键菜单（V1 仅三项）**：Copy Path（相对路径 / 绝对路径 / 文件名三种）、Reveal in Explorer（在资源管理器中显示）、Refresh。

#### 范围外（V1 明确不做）

- 树内新建 / 重命名 / 删除文件（涉及 FS 权限与编辑器联动，放 V2）；
- Find in Path（Shift+Alt+F）；
- 多根 / 模块级树结构（单根即可）。

#### 决策回填：打开语义方案 🔶 待 M0

| 方案 | 条件 | 交互 |
|---|---|---|
| **A（首选）** | dsh 暴露编辑器标签 API，可控制「预览/固定」语义 | 按上文 Preview Tab 行为实现 |
| **B（降级）** | 无标签级控制权 | Project 窗内分栏：左树 + 右侧内嵌只读预览区；单击窗内预览，双击才送入编辑器标签 |

> 方案 B 的调研结论若为「dsh 标签 API 只能打开、不能控制复用」，**优先尝试组合方案：单击 = 打开到固定预览位（每次 kill 同名旧标签再打开）**，仍不行再整体降级 B。

#### 验收标准

- [ ] 万级文件仓库首屏 < 1s，连续展开/折叠无可见卡顿；
- [ ] 连续单击 10 个不同文件，编辑器中 Preview Tab 始终只有 1 个，固定标签数不变；
- [ ] 双击后标签固定，再单击其他文件不会替换它；
- [ ] 编辑器切换文件后 ≤ 500ms 内树定位到该文件并高亮；
- [ ] 修改文件后 ≤ 1s 树节点变蓝（或绿，视 git status 刷新周期）；
- [ ] 重启 dsh 后展开状态与锚定侧恢复。

---

### 5.2 Commit 工具窗（Alt+0）

**目标**：脱离 dsh 自带 git 功能，完成「改 → 暂存 → 写消息 → 提交(并可推送)」全流程。

#### 范围内（V1）

1. **文件列表**：三组——`Staged Changes` / `Unstaged Changes` / `Unversioned Files`，每组带全选 checkbox；侧条 Badge = Unstaged 文件数（实时刷新）。
2. **Diff 查看器**：选中文件即展示；Side-by-Side / Unified 切换（默认 Side-by-Side）；
   - **行级暂存**：gutter 拖选行 → `Stage Selection`；整块 → `Stage Hunk`；
   - `Discard`：二次确认弹窗，文案含文件名与改动行数；
   - 新增/删除文件的 Diff 以全量绿/红展示。
3. **提交消息区**：
   - 多行编辑、最近 10 条历史消息下拉；
   - `Amend` 勾选（HEAD 为初始提交时禁用并提示）；
   - 双按钮：`Commit` 与 `Commit and Push`；
   - 提交成功 → 清空消息、刷新全部四窗；失败（如 pre-commit hook 拒绝）→ 错误输出内嵌展示，**消息不清空**。
4. `Ctrl+K` → 打开本窗并聚焦消息框。

#### 范围外（V1 明确不做）

- Changelist、多提交队列；
- 交互式提交钩子配置界面（只读执行已有 hook）；
- Pull / Fetch 按钮（顶栏留位，V1.1 实现——需先定义 pull 策略：merge or rebase）。

#### 验收标准

- [ ] 任意 git 操作后 ≤ 1s 三组分组与侧条徽标数字正确；
- [ ] 选中文件 → Diff < 300ms 出现；
- [ ] 行级暂存：选中 2 行 → `git diff --cached` 中恰好只有这 2 行变化；
- [ ] pre-commit hook 拒绝提交时，消息保留且错误可见；
- [ ] `Commit and Push` 失败时回滚提示正确（commit 成功 / push 失败两个状态明确告知）；
- [ ] `Ctrl+K` 在任意窗口可用且焦点落在消息框。

---

### 5.3 Terminal 工具窗（Alt+F12）

**目标**：内嵌完整 PTY 终端，交互式命令（git、npm、vim）全部可用。

#### 范围内（V1）

1. **内嵌 PTY**（node-pty 或 dsh 等价能力）+ xterm 类渲染；
2. **会话 Tab**：新建（`+`）、重命名、关闭（若有前台任务运行先确认再杀 PTY）、侧条 Badge = 活跃会话数；
3. **Shell Profile**：自动检测可用 shell，设置页可配置；Windows：PowerShell / CMD / Git Bash，macOS：zsh / bash；
4. **cwd 策略**：新会话默认 = 项目根；右键 Tab → `New Session at Current File's Directory`；
5. **环境注入**：向 shell 传递项目环境变量 / PATH（注入点取决于 dsh API，M0 确认）；
6. **Windows 编码专项（硬性）**：强制 UTF-8（如 PowerShell 设 `$OutputEncoding`/`[Console]::OutputEncoding`、CMD `chcp 65001`），中文与 emoji 输出不乱码；
7. 交互：选中即复制（可选开关）、`Ctrl+Shift+V` 粘贴、清屏、`Ctrl+F` 输出内搜索。

#### 范围外（V1 明确不做）

- 分屏、端口转发提示、任务运行器集成、本地历史持久化（重启不恢复会话，V1.1 再议）。

#### 验收标准

- [ ] `Alt+F12` 打开即有可用会话，提示符可用 < 1s；
- [ ] 交互式程序正常：`vim` / `npm install` / `git log --oneline --graph` 分页可用；
- [ ] **Windows 下 `echo 中文你好` 输出无乱码**（PowerShell、CMD、Git Bash 三个 Profile 分别验证）；
- [ ] 可同时开 3 个会话独立运行，互不串流；
- [ ] 关闭有运行中任务的会话时出现确认，取消则任务继续；
- [ ] 项目根目录含空格/中文时会话正常启动。

---

### 5.4 Git 工具窗（Alt+9）

**目标**：提交历史浏览与基本管理——日志、图谱、差异、分支。

#### 范围内（V1）

1. **日志表**：`Short SHA | Subject | Author | Time` + **Commit Graph 列**（节点连线；V1 只要求线性 + 简单分支拓扑正确，复杂拓扑允许退化为线性但不得错画）；
2. **过滤**：按分支、作者、关键字（Subject 搜索）；
3. **分页懒加载**：默认最近 200 条，滚动到底追加；
4. **详情区**：选中 commit → 全量 Diff + 元信息（full SHA、parents、refs 标签）；
5. **右键菜单（V1）**：Copy Full SHA、Checkout（检出该 commit → detached HEAD，需确认弹窗）、Revert（生成逆向 commit，需确认弹窗）、Open File at Revision（可后置，缺失时菜单隐藏）；
6. **顶部分支区**：当前分支名 + 本地分支列表 + 快速切换；detached 时明确显示。

#### 范围外（V1 明确不做）

- 交互式 rebase、merge 冲突 3-way 可视化（冲突一律在 Commit 窗标红，提示用 CLI 处理）；
- stash 管理（V1.1）、远程分支 / fetch / pull（V1.1）、blame（V2）、`Open File at Revision` 若 API 不支持则隐藏。

#### 验收标准

- [ ] `Alt+9` 打开 → 200 条日志首屏 < 1s；
- [ ] 图谱列在「主干 + 2 分支 + 1 合并」样例仓库上连线正确；
- [ ] 滚动到末尾自动加载下一批，无重复无遗漏；
- [ ] 选中 commit → Diff < 500ms；
- [ ] Checkout 到历史 commit 后，Project 树着色、Commit 窗状态同步刷新（验证 GitEventBus 生效）；
- [ ] 过滤结果与 `git log --author/--grep` 基线一致。

---

## 6. 里程碑与验收路径

| 阶段 | 内容 | 完成标志 | 验收 |
|---|---|---|---|
| **M0** | dsh 插件 API 调研（见第 7 章），回填决策表 | 《dsh 插件 API 能力清单》产出，7.2 全部决策项落定 | 文档评审通过 |
| **M1** | 插件骨架 + SettingsStore + RepositoryService + Project 窗 | 5.1 验收全部通过，日常自用开始 | 5.1 checkbox 全勾 |
| **M2** | Commit 窗 + GitEventBus 完善 | 可完全脱离 dsh 自带 git 功能完成日常提交 | 5.2 checkbox 全勾 |
| **M3** | Terminal 窗 | Windows 三 Profile 中文编码验收通过 | 5.3 checkbox 全勾 |
| **M4** | Git 窗 | 日志/图谱/右键操作可用 | 5.4 checkbox 全勾 |
| **M5** | 上架准备：i18n 补全 zh-CN、设置页完善、README/商店素材、dsh 版本兼容声明、与官方 sidebar 共存说明 | 发布 dsh 插件社区 | 商店审核通过 |

> 顺序不可调换：M1/M2 先于 M3，因为共享服务层（RepositoryService/GitEventBus）是四窗的地基；Terminal 与 Git 无依赖，M3/M4 可视情况并行。

---

## 7. M0 调研清单（执行者第一步）

### 7.1 必须验证的假设

| # | 假设 | 验证方法 | 影响 |
|---|---|---|---|
| 1 | sidebar 扩展点可注册**自定义面板**，且支持锚定左右、折叠、徽标数字 | 读 dsh 插件 API 文档 / 官方示例插件源码，写最小 demo | 产品形态是否成立 |
| 2 | 有**编辑器标签 API**：打开文件、感知当前活动文件、控制标签复用/固定 | 同上 | 决定 Project 窗走方案 A 还是 B（见 5.1） |
| 3 | 宿主进程可启动 **PTY**（node-pty 或等价），或插件可起子进程并接管 stdio | demo：起一个 PowerShell 并回显 | Terminal 窗可行性；不行则整窗砍掉或改「输出面板」降级（需回改本规格） |
| 4 | 有**文件变更/仓库事件**可订阅（否则轮询降级：2s 轮询 `git status`） | 读 API | 着色与徽标刷新延迟 |
| 5 | 插件可执行 **git CLI 子进程**、可自定义快捷键注册、可持久化设置 | demo | 全局 |
| 6 | dsh 插件 ID / 包名 / manifest 规范 | 官方插件开发文档 | 2 章命名落定 |

### 7.2 决策回填表（M0 结束时必须全部由 🔶 变为 ✅）

| 决策项 | 默认方案（API 不支持时的处置） | M0 结论 |
|---|---|---|
| 插件 ID 规范 | `dsh-ide-toolwindows`（若官方要求 owner 前缀则为 `io.github.<owner>.dsh-ide-toolwindows`） | ⬜ |
| Project 打开语义 | 方案 A → 组合方案 → 方案 B（见 5.1） | ⬜ |
| PTY 能力 | 有 → 按 5.3 实现；无 → 回改规格为输出面板（需产品负责人确认） | ⬜ |
| 事件源 | 订阅 API → 轮询 2s 降级 | ⬜ |
| 锚定/折叠 | 支持完整 Tool Window 行为 → 仅支持停靠固定（删除浮动/自动隐藏概念） | ⬜ |
| 设置持久化 | 插件自带 KV → 需 dsh 提供配置存储 | ⬜ |

---

## 8. 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| dsh 插件 API 能力不足（尤其标签控制与 PTY） | 高 | 全部收敛在 M0；每个决策项都有降级默认方案 |
| 快捷键 Alt+1/0/9 与 dsh 或系统输入法冲突 | 中 | 首启检测 + 设置页可重绑 |
| 与官方 sidebar 共存体验混乱 | 中 | M5 文档专节说明隐藏官方 sidebar 的方式 |
| 范围蔓延（V1 想做太多 git 高级操作） | 中 | 「明确不做」清单是硬约束，新需求一律进 V2 backlog |
| git CLI 输出格式跨版本差异（Windows 常见老版本 git） | 低 | 统一使用 `--porcelain=v2`、`-z` 等机器友好参数解析 |

---

## 9. V2 Backlog（记录，不做承诺）

树内新建/重命名/删除、Find in Path、Pull/Fetch、stash、blame、Open File at Revision、分屏终端、日志本地持久化、Shift+Shift 全局搜索、Cherry-pick/Interactive Rebase。
