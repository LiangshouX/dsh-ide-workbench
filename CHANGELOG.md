# Changelog

本文件记录 `dsh-ide-workbench` 的每个发布版本。发布页（GitHub Releases）的
说明直接取自这里对应版本的小节；没有对应小节的 tag 会退回 GitHub 自动生成的
提交说明。

## 0.5.0 (未发布)

### 视觉

- 文件树、编辑器页签、提交面板的文件图标改用宿主的 `FileTypeIcon`：与 DSH
  自带文件浏览器、`dsh-better-sidebar` 同一套品牌 logo（React / Java /
  TypeScript / C / C++ 等 48 种）与分类色 sheet 图标，随宿主皮肤自动切换。
- 删除本地手绘的 `FILE_TINTS` 调色板与约 190 行类型字形，以及本地文件夹图标；
  终端工具栏与项目选择器也改用宿主文件夹，全插件只剩一套文件夹字形。

### 修复

- 终端底部常驻黑色条：xterm 的 viewport 铺满整个终端且自带硬编码黑底，而
  内部 screen 只有 `rows * cellHeight` 高，FitAddon 取整后必然剩下一条 1–14px
  的黑边（任何窗口尺寸都在）。现在 viewport 让出终端自己的背景色。

### 发布

- 打 tag 发布时同时创建 GitHub Release：附带变更说明、源码，以及一个自带
  `node_modules` 的离线 npm 构建包。

## 0.4.1

### 性能（PRD-v4 第 1 章）

- `store.set()` 跳过全等补丁：等值写入不再替换状态、也不唤醒订阅者
  （50 次等值写入 → 0 次通知）。
- 切片订阅：ProjectPanel、EditorArea、GitPanel、CommitPanel、TerminalPanel、
  SearchView、DiffView 各自通过新的 `useStoreSlice()` 订阅自己的切片，无关写入
  （toast、终端分块、git 轮询）不再触发这些面板重渲染。
- 文件树 flatten memo 只依赖它真正读取的字段；树行是带稳定 `useCallback`
  处理器的 memo 化 `TreeRow`。
- LRU `StoreCache` 最多保留 3 个工作区 store，且绝不淘汰仍有 Session 挂载的
  那个。
- 热工作区复用已缓存的状态（0 次 git 子进程）；每个文件的行数只在提交窗口可见
  时统计；`--ignored=matching` 跟随"显示被忽略文件"设置。
- 冷工作区只列根目录、只读取聚焦页签。
- 目录列表改为一次 `readdir(withFileTypes)`，不再逐项 `lstat`。
- 宿主会话表做缓存，不再每次渲染都读。
- 开发用的 `window.__iwbPerf` 计数器不出现在生产构建里。

### 交互（PRD-v4 第 2–4 章）

- 树形 twisty 点击展开目录且不选中该行；"定位文件"按钮可在树中显示当前文件。
- Git 仓库选择器只挑选仓库，不动文件树；IDE 项目不会因此改变。

### 修复

- 3 个严重、1 个验收缺口、9 个中等、7 个轻微问题（PRD-v4 代码评审）。

## 0.4.0

### 功能

- 发送到聊天：文件树与代码编辑器都能把文件/文件夹作为 @path 引用插入；代码
  选区会带上行号范围与围栏代码块。
- 发布前 QA 修复：终端 refit/resize、感知 CRLF 的冲突处理、关闭时刷新设置、
  查找文件选项开关、Markdown 预览默认开启、恢复的树加载、编辑器右键菜单。
- 新图标与一行徽标条；README/README_EN 重写为纯 GFM，图片改用绝对地址，特性
  改成两列表格。
