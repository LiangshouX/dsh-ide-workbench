# 性能基准测试脚手架

本目录是 `docs/代码智能-性能开销评估.md` 的**可复现脚手架**，支撑 PRD-v5 §11 性能预算的验收。

> **不随插件分发**：`dsh-ide-workbench/package.json` 的 `files` 白名单（`package.json:23-35`）不含 `docs/`，因此本目录不会进入 npm 发布包，也不会进入离线 tarball。

## 一次性准备

```powershell
cd docs/bench
npm install          # 安装 ws / esbuild / typescript / typescript-language-server / @codemirror/lsp-client
```

合成测试项目（体积较大，生成后请自行清理）：

```powershell
# 3,000 个 TS 文件的合成项目（用于复现 2,202 MB 那一档）
node big-project.mjs . ..\bigproj 3000 200

# 更接近真实仓库的合成项目（中心依赖 + 严格模式）
node gen-realistic.mjs ..\realproj 1500 150
```

## 各项实测

```powershell
# 语言服务器进程树 RSS + CPU（CIM 采样，含 tsserver 孙进程）
node diag4.mjs . ..\bigproj 180 2048 15 src/file0.ts

# 宿主 JSON parse vs 字节中继成本 + 事件循环漂移
node host-cost.mjs

# worker_thread 隔离验证（宿主漂移 max 8 ms）
node host-realistic.mjs .

# 客户端产物增量（@codemirror/lsp-client + marked）
npx esbuild entry.mjs --bundle --minify --format=esm --outfile=out.js
```

`diag*.mjs` 的参数依次为：基准目录、项目目录、等待秒数、`--max-old-space-size`、空闲观察秒数、可选待打开文件。

## 端到端实机验证（真语言服务器）

`live-lsp.mjs` 用**真的** `typescript-language-server` 跑一遍完整链路：
宿主 `apply()` → `ctx.subprocess.spawn` 起进程 → worker_thread 帧编解码 → `/ide-workbench/ws/lsp` 中继 →
`initialize` 握手 → `textDocument/definition` → 断线重连后的二次握手。

```powershell
cd dsh-ide-workbench
node docs\bench\live-lsp.mjs
```

预期输出（本机实测）：

```text
lsp.start -> {"state":"building","detail":"building the program"}
websocket open
initialize ok - capabilities: textDocumentSync, completionProvider, definitionProvider, referencesProvider, hoverProvider, signatureHelpProvider, ...
lsp.status -> ready | language: typescript | source: bundled
lsp.index  -> {"state":"ready","progress":"ready","cancellable":false}
textDocument/definition -> [{"uri":"file:///.../src/client/lsp-uri.js","range":{"start":{"line":1,"character":16},...}}]
reconnect initialize -> answered, capabilities: 23
```

> 这个脚本**不是**单元测试（它会真的起一个语言服务器进程），所以放在 `docs/bench/` 而不是 `tests/`。
> 它同时是 §9.4「服务器生命周期」与「跳转定义」两组实机验收的自动化替身。

## 三个验证脚本（都以退出码说话）

| 脚本 | 验证什么 | 前提 | 退出码 |
|---|---|---|---|
| `live-lsp.mjs` | 真语言服务器跑通完整链路（握手 → 定义请求 → 重连） | 仓库 `node_modules` 里有 `typescript-language-server`（实测 6.0.2） | 0 = 通过 |
| `repro-order.mjs` | D2 / D10：浏览器真实顺序（**先连 socket、后启动服务器**） | 同上；脚本用一份一次性 profile（`DSH_PROFILE_DIR`）把内存门槛调低，内存不宽裕的机器也能跑到那个场景 | 0 = 通过，1 = 某一步失败，2 = 这台机器跑不了这个场景 |
| `crash-recovery.mjs` | D1：语言服务器崩溃 → 宿主必须活着（0 未处理 rejection） | 无（纯假件） | 0 = 通过，1 = 某一步失败，2 = 这台机器跑不了这个场景 |

> 「跑不了这个场景」（退出码 2）指的是**前提不满足**，例如内存不够或没装语言服务器 ——
> 这和「场景失败」（退出码 1）是两回事，脚本会自己说明是哪一种。
> `repro-order.mjs` 与 `crash-recovery.mjs` 都会在结束时删掉自己的一次性 profile。

## 实测结论速查

| 场景 | 结果 |
|---|---|
| 小项目语言服务器 | ~60–100 MB |
| 800 文件 strict | 1,783 MB |
| 3,000 文件 | 2,202 MB |
| 3,120 文件中心依赖 strict | **4,431 MB → OOM（exit 134 / SIGABRT）** |
| 空闲 20 s CPU 消耗 | 0.00 s（0.0% 单核） |
| 主线程 parse 漂移 | max 412 ms → worker_thread 隔离后 max 8 ms |
| 客户端产物增量 | 363 KB（2,413 KB → ~2,776 KB，+15%） |
