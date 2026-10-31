![IDE Workbench](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/icon.svg)

# IDE Workbench

**把 JetBrains 式 IDE 工作区搬进 DeepSeek Harness 的右侧栏。**

Project / Commit / Git / Terminal 四个工具窗围绕插件自带的编辑器，与聊天同屏协作——文件、代码行、提交和终端都留在对话旁边，不用来回切换窗口。

[![npm 包 · MIT 许可证 · DSH ≥ 0.1.7 · Windows / macOS / Linux](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/badges.svg)](https://github.com/LiangshouX/dsh-ide-workbench)

简体中文 · [English](https://github.com/LiangshouX/dsh-ide-workbench/blob/main/README_EN.md)

![IDE Workbench 概览：Commit 面板、编辑器中的 Diff 与 Git 日志同屏](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/hero.png)

## 为什么是 IDE Workbench？

DSH 的对话很适合“边聊边改”，但真正改代码时还是要在聊天、终端、文件管理器和 IDE 之间来回跳。IDE Workbench 把一整套 JetBrains 风格的工作区放进 DSH 的右侧栏，并且**始终和当前会话在一起**：

- **与聊天同屏**：聊天里的文件链接直接在工作台打开并定位到行；反过来，在项目树或编辑器里右键 **发送到聊天框**，就会在聊天输入框里插入 `@路径` 引用——选中代码时连同行号和代码一起带上。
- **IDEA 手感**：`Alt+1` / `Alt+0` / `Alt+9` / `Alt+F12` 切换工具窗；单击预览、双击固定标签；`Alt+Insert` 新建、`F2` 重命名、`Ctrl+K` 聚焦提交、`Ctrl+Shift+K` 推送。
- **真实仓库与终端**：Git 全部走系统 CLI（凭证管理器、hooks、git config 原样生效）；终端是真实 PTY；文件读写经过路径围栏，保存保留原编码与换行符。
- **跟随 DSH**：只用宿主的主题令牌，明暗/皮肤自动跟随；右侧栏原生 tab、会话连续性、设置页；DSH Desktop 与 Web profile 都能安装。

## 功能一览

| 界面 | 功能 |
|:--|:--|
| ![Project 工具窗](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/project.png) | **Project 工具窗。** 惰性加载的文件树，JetBrains 状态色（红 = 未跟踪、绿 = 新增、蓝 = 已修改，目录递归染色）。单击选中、双击打开或展开；目录箭头单击即可展开/折叠。Ctrl/Shift 多选、拖拽移动（Ctrl = 复制）。新建文件/目录、F2 重命名、Delete 删除（优先进回收站）、F5 复制、F6 移动、Ctrl+X/C/V。【文件定位】一键跳到当前打开的文件、树内过滤与全项目文件名快速定位；右键菜单直接 **发送到聊天框**。 |
| ![CodeMirror 编辑器](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/editor.png) | **内置编辑器。** CodeMirror 6，语法高亮；自动 / 始终可编辑 / 始终只读三档打开模式，自动档下 1 MiB 以内的文本可直接编辑（Markdown 默认进渲染预览）。`Ctrl+S` 原子保存并保留 UTF-8 / BOM / UTF-16 与 CRLF，脏点与“未保存”提示清晰。外部程序改动触发**居中于文档区的冲突弹窗**，可“从磁盘重新加载”或“覆盖磁盘”；同一文件被自己保存后不再误报。编辑器内查找/替换、光标行列与编码状态栏。 |
| ![Markdown 预览与大纲](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/markdown.png) | **Markdown 预览。** 用宿主 `MarkdownText` 渲染，表格、任务列表、代码卡与 DSH 聊天排版一致。默认直接进入渲染预览，“预览 / 源码 / 编辑”一键切换；文档大纲可跳转并跟随滚动高亮。打开文档不再先落到源码编辑器里。 |
| ![全项目查找](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/search.png) | **全项目查找与快速打开。** `Ctrl+Shift+R` 全项目搜索（浏览器形态请用备用键 `Ctrl+Alt+F`），Aa / 全词 / 正则三个开关全部可用。结果按文件分组并显示命中数、耗时；点击命中直接在编辑器中定位到行。`Ctrl+P` / `Ctrl+Shift+N` 按文件名快速打开全项目文件。 |
| ![Commit 工具窗](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/commit.png) | **Commit 工具窗。** `Changes` / `Unversioned` 两组，勾选即纳入本次提交且列表不跳动；变更列表（Changelist）、按目录分组。Change View（工作区 / 上次修订 / 最新提交）+ 跳转到源码 + 回滚；Diff 工具栏支持行/块级暂存。提交、提交并推送、Amend、最近提交消息、可选 pre-commit 命令（测试 / 优化导入 / 清理）。 |
| ![统一 Diff](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/diff-unified.png) | **Diff。** 并排 / 统一两种布局，单词级高亮，未变更块可折叠。与工作区、上次修订、任意提交或两个提交（Ctrl+点击）比较；可直接暂存/丢弃单个 hunk。HTML/二进制文件走 DSH 侧栏或系统默认程序预览。 |
| ![Git 历史与详情抽屉](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/git.png) | **Git 历史。** 分页提交表 + 泳道式 commit graph；按分支 / 作者 / 消息 / 路径过滤。单击选中、双击（或 Enter）打开右侧详情抽屉：元信息、完整消息、变更文件，点文件看逐文件 Diff。复制 SHA、检出、回退、两提交 Compare；从项目树可对指定路径定向查看历史。 |
| ![终端](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/terminal.png) | **Terminal。** 真实 PTY（WebSocket + xterm.js），支持多会话、重命名、关闭；shell profiles（PowerShell / Git Bash / cmd / …）。停靠 ↔ 全屏、面板缩放后自动按新宽度重排，并向 PTY 发送 resize。选中即复制、`Ctrl+Shift+V` 粘贴；工作目录跟随项目根或当前文件。 |
| ![编辑器右键发送到聊天框](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/send-chat.png) | **与聊天协作。** 聊天里的文件链接默认在工作台打开并定位 `#L24`；工作区外自动降级到 DSH 自带侧栏。项目树 / 编辑器右键 **发送到聊天框**：文件或文件夹插入 `@路径` 引用；选中代码时追加行号与代码块。HTML 可在 DSH 侧栏或系统浏览器预览；不抢走聊天输入的焦点。 |
| ![IDE 工作台设置](https://raw.githubusercontent.com/LiangshouX/dsh-ide-workbench/main/docs/readme/settings.png) | **设置与快捷键。** 工具窗/命令快捷键、默认 shell、终端字号、打开模式、Markdown 预览、隐藏/忽略文件、聊天链接行为、外部 IDE 路径、git 路径与提交命令。修改后约 300 ms 自动落盘并显示“已保存”；关闭面板前不会丢失最后一次改动。设置页固定头部与关闭按钮，长表单滚动时不迷路。 |

## 安装

**前置**：DSH ≥ 0.1.7（DSH Desktop 0.2.x 或 Web profile 均可）。插件已发布到 npm：[dsh-ide-workbench](https://www.npmjs.com/package/dsh-ide-workbench)。

### 方式一：DSH Desktop（推荐）

1. 打开 **设置 → 插件**。
2. 点 **添加插件**，在包名输入框填入 `dsh-ide-workbench`（可带版本号，如 `dsh-ide-workbench@0.4.1`）。
3. 安装完成后，在会话头部点 IDE 工作台按钮（或侧栏底部的常驻入口）打开。

> Desktop 的 profile 由 Electron 应用独占管理，`dsh plugin --profile desktop ...` 会被拒绝——桌面端请走插件页安装。

### 方式二：CLI / npm

```sh
# 安装到指定 profile（例如 web）
dsh plugin --profile web add dsh-ide-workbench

# 只装指定版本
dsh plugin --profile web add dsh-ide-workbench@0.4.1
```

安装后重启该 profile；如果 bundle 尚未启用，在 **设置 → 插件** 里打开 **IDE Workbench**。

### 方式三：Git 仓库或本地目录

```sh
# 直接从 GitHub 安装（仓库自带构建好的 dist/client.js）
dsh plugin --profile web add git+https://github.com/LiangshouX/dsh-ide-workbench.git

# 或克隆后从本地目录安装
git clone https://github.com/LiangshouX/dsh-ide-workbench.git
dsh plugin --profile web add ./dsh-ide-workbench
```

### 方式四：Release 离线包（不联网也能装）

每个 [Release](https://github.com/LiangshouX/dsh-ide-workbench/releases) 都附了一个
自带 `node_modules` 的 npm 构建包（`dsh-ide-workbench-<版本>.tgz`），运行时依赖
已经打进去，装的时候不需要访问 npm registry：

```sh
# 把 <版本> 换成 Release 的 tag（如 v0.5.0）
dsh plugin --profile web add https://github.com/LiangshouX/dsh-ide-workbench/releases/download/v0.5.0/dsh-ide-workbench-0.5.0.tgz
```

Release 页同时提供变更说明（取自 [CHANGELOG.md](CHANGELOG.md)）与源码包
（GitHub 自动附带）。

### 安装后

- 入口有三处：会话头部按钮、新建会话行、左侧栏底部动作。
- 工作台是右侧栏的原生 tab，可以和聊天并排；在 `F11` 全屏与停靠之间切换。
- 第一次打开会自动选择当前 DSH 工作区；项目面板头部可切换 IDE 项目根（工作区根或一级子目录）。

## 快速上手

1. **打开工作台**：点会话头部的 IDE 图标，或按 `Alt+1` 直接聚焦 Project。
2. **选项目**：项目面板头部的下拉选择工作区根或某个一级子目录（含 `.git` 的子目录带 Git 徽标）。
3. **开始工作**：双击文件打开；`Ctrl+Shift+R` 搜代码、`Alt+0` 提交、`Alt+F12` 开终端、`Ctrl+K` 写提交信息。

### 常用快捷键

| 动作 | 快捷键 |
|:--|:--|
| 切换工具窗 | `Alt+1` Project · `Alt+0` Commit · `Alt+9` Git · `Alt+F12` Terminal |
| 聚焦提交消息 / 推送 | `Ctrl+K` / `Ctrl+Shift+K` |
| 全项目查找 / 备用键 | `Ctrl+Shift+R` / `Ctrl+Alt+F` |
| 快速打开文件 | `Ctrl+P` 或 `Ctrl+Shift+N` |
| 全屏 / 停靠 | `F11` |
| 隐藏全部工具窗 | `Ctrl+Shift+F12` |
| 编辑器内查找 | `Ctrl+F`、`F3` |
| 保存 / 关闭标签 | `Ctrl+S` / `Ctrl+W` |
| 文件操作 | `Alt+Insert` 新建 · `F2` 重命名 · `F5` 复制 · `F6` 移动 · `Delete` 删除 · `Ctrl+Alt+Shift+C` 复制路径 |
| 提交详情 | `Ctrl+Alt+D` |

> 工具窗、提交、推送、查找与快速打开快捷键可在 **设置 → IDE 工作台** 中重绑；`F2` / `F5` / `F6` / `Delete`、`Ctrl+Alt+D` 与 `Ctrl+Shift+F12` 使用默认值（也可在设置文档中手动修改）。

## 工作区 vs IDE 项目根

DSH 工作区常常是容器：根本身不是 Git 仓库，一级子目录才是。项目面板头部的项目名下拉可以选择 **工作区根** 或任一一级子目录；选择会按工作区持久化（`projectRoots`），切换后 Project 树、Git/Commit 数据、新终端会话的 cwd 与保存的标签状态一并切换。当前目录不是仓库时，四个窗口都会给出“选择 Git 子项目”引导。

## 与 DSH 的集成

- **入口**：会话头部按钮、新建会话行、侧栏底部常驻动作三处均可打开，使用原生 `sidebar.right.pane.tab` 与聊天并排；皮肤隐藏头部工具时底部入口仍可用。
- **会话连续性**：同一 DSH 工作区的会话共享一份工作台状态——切换会话（含新建）保持文件树、打开的标签与 Git 上下文；工作台在被离开的会话中可见时，进入新会话会自动重新打开。切换对话不销毁终端；切换 Session 时终端进程与编辑器撤销栈会重建。
- **聊天文件链接**：用户 `@` 引用与助手 Markdown 链接默认在工作台打开，展开文件树并定位到 `#L24` 这样的行号；工作区外的文件自动降级到 DSH 自带侧栏；在工作区内但不在当前 IDE 项目内时，先询问是否把 IDE 项目拓宽到工作区根。设置 → IDE 工作台 → 聊天文件链接可切回始终使用 DSH 侧栏。
- **发送到聊天框**：在项目树或编辑器里右键，把一个或多个文件/文件夹、或选中的代码行送进聊天输入框。文件/文件夹以 `@路径` 形式成为引用；代码行会附带 `(L起-L止)` 与代码块。
- **预览降级**：右键文件或标签 → 在侧栏标签中打开，用 DSH 自带预览查看；HTML 文件右上角提供“在 DSH 侧栏预览”和“用默认浏览器打开”两个浮动动作。
- **主题**：仅使用 `--dsw-alias-*` 令牌，明暗与皮肤完全跟随宿主。

## 安全与数据

- Git 全部走系统 CLI（argv 数组，绝无 shell 字符串），凭证管理器、hooks 与 git config 原样生效；路径从 `status --porcelain=v2 -z`、`diff --numstat -z` 与 `log` 记录流解析。
- 文件读写经过路径围栏（越界 403），保存原子化并保留原编码与换行符。
- 每个 HTTP / WebSocket 路由都经过与 `/api` 相同的 Connection 准入围栏。
- 设置持久化在 `$DSH_HOME/ide-workbench/settings.json`（`~/.dsh`；宿主导出 `DSH_PROFILE_DIR` 时使用 profile 目录），含快捷键、Shell、git 路径、打开模式、UI 几何、每工作区展开目录与打开标签。

## 已知限制

- 项目选择器只扫描工作区**一级**子目录，不递归发现仓库。
- DSH 重启不恢复终端会话（PTY 随进程结束）。
- 宿主侧条图标不支持数字徽标（徽标绘制在插件自绘的 stripe 上）。
- Markdown 预览暂不把相对图片 / 链接重写为本地路径（http(s) 外链可用）。
- 不做：交互式 rebase、merge 冲突三方编辑、stash、blame、fetch/pull、分屏终端。
- `Ctrl+Shift+R` 在**纯浏览器形态**（DSH Web、Chromium 内核浏览器）里是 Chromium 的**硬刷新**快捷键，网页侧无法拦截 → 会整页刷新、丢失编辑器缓冲区。**浏览器形态请用备用键 `Ctrl+Alt+F`**；桌面形态（DSH Desktop）不受影响。
- **发送到聊天框**依赖宿主向会话槽位发布的聊天输入动作；宿主未提供时会提示“暂时无法写入聊天输入框”，不会静默丢弃。代码行引用以 `@文件 (Lx-Ly)` + 代码块表达（`@` 语法本身没有行号后缀）。
- 编辑器右键菜单只在**有选中内容**时接管系统菜单（提供“发送到聊天框 / 复制”），空选区保留原生菜单。

## 开发

```sh
npm install
npm run build      # 将 src/client 打包为 dist/client.js（React 外置，xterm 内联）
npm test           # 宿主 git/diff/graph + 组件 SSR + 客户端回归测试
```

源码结构：

```
src/index.js                宿主半边：围栏 HTTP API + 终端 WebSocket
src/host/git.js             git CLI 适配器，status/log/numstat 解析
src/host/workspace.js       路径围栏、目录树、文件预览、shell
src/host/fileops.js         新建/重命名/复制/移动/删除（回收站）
src/host/settings-store.js  JSON 设置持久化
src/client/index.jsx        客户端入口：侧栏 tab、快捷键、聊天输入桥
src/client/store.js         工作台状态机（项目、标签、搜索、Git、设置）
src/client/*.jsx            工具窗与编辑器 UI
src/client/chat-bridge.js   发送到聊天框：@ 引用与代码块
```

提交前请重新构建 `dist/client.js` 并跑完 `npm test`（当前 324 条测试）。

README 的截图与徽标条存放在 `docs/readme/`，通过 `main` 分支的 raw URL 引用——DSH 与 npm 的 Markdown 渲染都不解析相对图片路径，raw URL 同时兼容 GitHub、IDEA 与 Typora。顶部的 `badges.svg` 把 npm / 许可证 / DSH / 平台合成一张图，因为 DSH 会把独立图片渲染成块级元素，四个单独的徽章会各占一行。截图源文件在 `qa-screenshots/`（工作区仓库），修改后按 720px 宽导出并更新 `docs/readme/`。

## 反馈与许可

- 问题 / 建议：[GitHub Issues](https://github.com/LiangshouX/dsh-ide-workbench/issues)
- 发布记录：[GitHub Releases](https://github.com/LiangshouX/dsh-ide-workbench/releases) · [npm versions](https://www.npmjs.com/package/dsh-ide-workbench?activeTab=versions)
- 许可证：MIT。xterm.js 与 ws 遵循各自的 MIT 许可。

> 截图来自 DSH Desktop 0.2.1（Windows 11，亮色主题）；界面语言跟随 DSH 设置。示例项目为测试用 Git 沙箱。
