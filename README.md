# dsh-ide-workbench（monorepo）

DeepSeek Harness 的 IDE 工作台，**拆成两个可独立安装 / 更新 / 发版的插件**。

| 包 | 插件 ID | 做什么 | 文档 |
|---|---|---|---|
| [`packages/workbench`](packages/workbench) | `dsh-ide-workbench` | **core**：Project / Commit / Terminal / Git 四窗 + 内置编辑器 + 文件定位 + 仓库选择器。**没有任何补全**（但保留自动闭合括号） | [中文](packages/workbench/README.md) · [English](packages/workbench/README_EN.md) |
| [`packages/codeintel`](packages/codeintel) | `dsh-ide-codeintel` | **代码智能**：本地与语义补全、跳转定义、查找用法、悬浮与签名、语言服务器与记忆预算 | [中文](packages/codeintel/README.md) · [English](packages/codeintel/README_EN.md) |
| [`packages/contract`](packages/contract) | —— | 契约包（private，不发版）：两包之间的接口 | — |

> 目录名 ≠ 包名是刻意的：npm workspace 以 `package.json.name` 为准，DSH 也以包名为插件 ID。
> `packages/workbench` 在磁盘上是「core」，在 DSH 里仍然是「工作台」。

## 安装

```bash
# 只装工作台（干净基线，无补全、无语言服务器）
dsh plugin --profile web add dsh-ide-workbench

# 只装代码智能（会提示缺少工作台）
dsh plugin --profile web add dsh-ide-codeintel

# 双装（等价于拆分前的完整功能面）
dsh plugin --profile web add dsh-ide-workbench dsh-ide-codeintel
```

内网 / 断网机器用 Release 里的 `-offline.zip`（自带 `node_modules` 与安装脚本），
详见各包 README 的「安装」小节。

## 开发

```bash
npm install          # 安装两个包与根编排
npm run build        # 同步契约 + 构建两个客户端产物
npm test             # 两个包的测试 + 跨包契约测试
```

| 脚本 | 作用 |
|---|---|
| `npm run sync:contract` | 把 `packages/contract/src` 内联进两个插件的 `src/contract/`（**生成物，勿手改**） |
| `npm run gen-cm-shims` | 重新生成 codeintel 的 CodeMirror 惰性代理 shim（升级 CodeMirror 后跑） |
| `npm run build:core` / `npm run build:codeintel` | 单独构建一个包 |
| `npm run verify` | 构建 + 全部测试 |

## 发版

两个包**各有独立的版本线**，tag 决定发哪个包：

```bash
git tag v0.6.0            && git push --follow-tags   # 发布 dsh-ide-workbench 0.6.0
git tag codeintel-v0.1.0  && git push --follow-tags   # 发布 dsh-ide-codeintel 0.1.0
```

- core 沿用历史 tag 形式（`v0.4.0` … `v0.6.0`）；codeintel 用 `codeintel-v<版本>` 前缀区分。
- 发布说明取自对应包的 `CHANGELOG.md`。
- 契约版本 `CONTRACT_VERSION` 独立于两者：**只有 major 变更**才要求另一方一起升。

## 规格

- [`docs/prd/v6/PRD-v6-插件拆分.md`](docs/prd/v6/PRD-v6-插件拆分.md) —— 拆分规格（归属与装载方式）
- [`docs/prd/v6/PRD-v6-实施契约.md`](docs/prd/v6/PRD-v6-实施契约.md) —— 两包之间的接口写死件
- [`docs/prd/v6/PRD-v6-实施进展.md`](docs/prd/v6/PRD-v6-实施进展.md) —— 落地记录

## 许可

MIT
