# AGENTS.md — dsh-ide-workbench 开发规范

> 给在这个仓库里工作的 AI Agent 与人看的**操作纪律**。
> 规则的真源是代码与测试；本文只是把「怎么改、怎么验、怎么交付」写死。

---

## 一句话

这个仓库是**开发对象**，不是运行中的东西。
**跑起来的东西是 profile 里装的那一份插件**（core：`dsh-ide-workbench`，codeintel：`dsh-ide-codeintel`）。

---

## 1. 仓库结构与边界（改代码前先认清自己在哪一半）

```
packages/workbench   ← core：IDE 工作台本体（宿主半边 + 客户端半边）
packages/codeintel   ← codeintel：语言服务 / 语义补全（独立插件）
packages/contract    ← 两个包之间的契约（常量 + 类型）
```

| 半边 | 目录 | 规矩 |
|---|---|---|
| **宿主半边** | `packages/workbench/src/host/**`、`src/index.js` | 只管数据与路由。**不许做渲染**，不许把界面逻辑塞进来 |
| **客户端半边** | `packages/workbench/src/client/**` | 全部 UI 在这里。**重活放客户端**（转码、解析、裁剪），不占宿主进程 |
| **契约** | `packages/contract/src/**` | core 与 codeintel 的唯一通道。**两端必须成对升级**，改了一边另一边就是坏的 |

> core **不许知道** codeintel 的存在；codeintel 通过契约插槽进来。
> core 与 codeintel 的边界是 PRD-v6 定的，拆不动。

---

## 2. 安装纪律（最容易出事的一条）

### 规则

> **永远不要把源码目录当安装目标。先构建，再打包，再安装。**

```bash
npm run build          # 契约同步 + core 客户端包 + codeintel 客户端包
npm run verify         # build + 全量测试 + verify:split（拆分边界检查）
```

然后用 `plugin_manager` 的 `install_bundle` / `remove_bundle` 装**打包产物**。

### 为什么

把安装目标指向源码目录时，profile 里留下的是**指向仓库的软链**，于是同时踩三个坑：

| 坑 | 后果 |
|---|---|
| 仓库里的一次误改**立刻**改变运行中的插件 | 分不清哪一份是发布物；线上行为不可复现 |
| 打包工具在仓库里落下 `node_modules/`、`pnpm-lock.yaml` | **弄脏 git**，源码与安装产物混在一个目录 |
| 目录被移动/删除/切分支 | 运行中的插件直接断掉 |

### 改了源码之后

```bash
npm run build          # ① 必须重建客户端包
npm test               # ② 必须全绿
# ③ 重新打包并安装到 profile，然后刷新 DSH 页面
```

两条**不能省的**事实：

- **`packages/workbench/dist/client.js` 是入库的产物**（`.gitignore` 只忽略 `client.bundle.cjs` / `client.dev.*`）。
  改了 `src/client/**` 而没有重建、提交 `dist/client.js`，**线上行为不变**。
- **Host 半边不会热重载**：改 `src/host/**` 要重启 DSH 才生效；只改客户端则刷新页面即可。

### 离线 / 内网机

```bash
node scripts/make-offline.mjs --only workbench
```

产出自带 `node_modules` 的 zip + `SHA256SUMS.txt`，用 `scripts/offline/install-offline.ps1` 装。
内网机**不要**在断网状态下跑 `pnpm install`。

---

## 3. 改动纪律

1. **真源唯一。** 一份事实只存在一处：设置在 `settings.json`，树在 `dirs`，编辑内容在 buffer。
   派生字段（编译出来的文案、diff 行模型）**不许手写**，改真源再重编译。
2. **改真源要重编译。** 改完真源不重编译，产物就是**过期**的 —— 界面显示的是旧事实，比没有还糟。
3. **契约两端成对升级。** 改 `packages/contract` 必须同时改 core 与 codeintel，并升 `CONTRACT_VERSION`。
4. **宿主围栏不能松。** 所有路径都要过 `resolveInside` / `canonicalRoot`；文件、命令、IDE 启动一律在围栏内。
5. **不许硬编码配色。** 样式一律走 `var(--iwb-*)` 主题令牌（`tests/styles-theme.test.mjs` 守着这条）。
6. **一个功能一个落点。** 新能力优先加在**已有的**语义位置上（右键菜单、状态栏、设置项），
   不要为了「新」而新开一个入口 —— 入口越多，用户越找不到。

---

## 4. 性能是红线

> 插件是**嵌在别人的主应用里**的：插件慢一点，用户就会说「DSH 卡了」。
> 功能做得再好也救不回来——一个卡顿的插件会被直接关掉。

所以性能不是「有空再优化」，是**红线**：要有能测、能卡住回归的闸门。

### 闸门就在测试里

```bash
npm test
```

`packages/workbench/tests/perf-*.test.mjs` 就是闸门，它们**不是**「跑得慢就跳过」的用例，是**断言**：

| 闸门 | 守着什么 |
|---|---|
| `perf-hot-path` | 客户端产物不许塞进新的同步大依赖；语言包与 promise 站点数量是**钉死**的 |
| `perf-cold-workspace` | 冷启动的工作台不许做无谓的全量扫描 |
| `perf-notify` | store 通知不许引发无谓的重渲染 |
| `perf-slice-project` / `-editor` / `-git` | 每个面板**只能**读自己的 slice；源码里多读一个 `state.` 就红 |

**过不了闸门的代码不算写完。**

### 六条规矩（每条都对应一个已经解决的真问题）

1. **轮询必须带 revision。** 服务端每次返回内容指纹，客户端比对相同就**跳过 setState**。
   没有它，面板会每隔几秒重建一次（几百行树 + 差异）——那是「插件让 DSH 卡顿」最常见的来源。
2. **列表只判断存在性，不要读内容。** 文件列表曾经为了显示图标把整个目录读一遍。
3. **响应体积要封顶。** 大文件按上限截断并**如实报出**被截断的事实，不许假装完整。
4. **大对象不进内存常驻。** 终端输出、录音、预览字节用完即弃或落盘，不在插件里攒着。
5. **重活放客户端。** 音频转码、字节解码、大 diff 解析都在浏览器里做，不占 Host 进程。
6. **不要在 Host 里做渲染。** Host 只管数据与路由，UI 全在 `client/`。

---

## 5. 测试与验收纪律

| 事项 | 规矩 |
|---|---|
| **改动面** | 每个改动都要有**对应用例**；没有用例的缺陷能长期存活（见 `docs/issues/` 里的教训） |
| **断言要语义化** | 断言**行为**，不要断言**字面量**；只做词法断言的用例守不住「文案说的是不是事实」 |
| **文档** | 用户可见的行为变化要写进 `docs/prd/<版本>/` 里的规格或进展记录 |
| **实机** | 改完要在真机上跑一遍（Chrome DevTools MCP 可以连本机 DSH），截图留档 |
| **回归** | 修缺陷时**先写复现用例**，再改；用例要能证明「改之前红、改之后绿」 |

---

## 6. 文档纪律

- 规格按版本分层：`docs/prd/vN/PRD-vN.md` 是该轮的**唯一规格**，实现以它为准。
- 配套记录（实施进展 / 缺陷跟踪 / 代码检视报告）放同一个目录，文件名带主题。
- **规格与实施记录分开**：规格不随实施进度改写，实施记录写偏差与决策。
- 每条结论都要能复核到 `file:line`；读码确认 / 实测确认 / 推断**分别标注**。

---

## 7. 提交纪律

- 一个提交一件事；提交信息用仓库既有的前缀（`feat(core):` / `fix(core):` / `perf(core):` / `docs(core):` / `build(core):`）。
- **改了客户端源码，提交里必须带重建后的 `dist/client.js`。**
- 不把 `node_modules/`、`build/`、临时探针目录、密钥（哪怕是本地调试密码）提交进仓库。
- 不在 `main` 上直接开发：从当前基线拉分支，PR 合回 `main`。
