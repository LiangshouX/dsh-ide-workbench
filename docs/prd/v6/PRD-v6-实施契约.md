# PRD-v6 实施契约（拆分接口的写死版本）

> **状态**：实施中。本文是 `PRD-v6-插件拆分.md` 的**配套写死件**：PRD 决定「谁拥有什么」，本文决定**「两边之间的接口长什么样」**。
> **规矩**（沿用 `PRD-v5.1-实施契约.md`）：**本文写死的东西，任何一方不得自行改名或改语义；本文没写的东西由各自模块自行决定。**
> **代码基线**：`dsh-ide-workbench` commit `b2317fa`（0.5.1），仓库已改为 monorepo。

---

## 0. 仓库结构（已落地）

```
dsh-ide-workbench/                     ← 仓库根（只做编排）
├── package.json                       ← npm workspaces 根，private
├── packages/
│   ├── contract/                      ← 契约包（private，不发版）
│   │   ├── src/index.js               ← CONTRACT_VERSION / HOST_SERVICE / SLOT_KEYS / mergeExtensionSlots
│   │   ├── src/fault-registry.js      ← 故障归属注册表（Symbol.for + globalThis）
│   │   ├── src/host-api.d.ts
│   │   └── src/client-api.d.ts
│   ├── workbench/                     ← core（插件 ID 仍是 dsh-ide-workbench）
│   │   ├── src/{index.js,host/,client/,contract/}
│   │   ├── tests/
│   │   └── dist/client.js
│   └── codeintel/                     ← codeintel（插件 ID dsh-ide-codeintel）
│       ├── src/{index.js,host/,client/,contract/}
│       ├── tests/
│       └── dist/client.js
├── scripts/{sync-contract,build-client,gen-cm-shims}.mjs
└── tests/                             ← 跨包契约测试
```

- **契约包的落地方式**：契约包**不进任何插件的 `dependencies`**。它是**源码级依赖**：两包各自把 `packages/contract/src/*.js` **内联**进 `src/contract/`（由 `npm run sync:contract` 生成并提交）。两份副本靠 `Symbol.for` + `globalThis` 共享运行时状态。
- **CodeMirror shim** 由 `npm run gen-cm-shims` 生成到 `packages/codeintel/src/client/vendor/cm-*.js`。

---

## 1. 命名与路径（写死）

| 事项 | 值 |
|---|---|
| core 的插件 ID / 包名 | `dsh-ide-workbench`（**不变**，D4） |
| codeintel 的插件 ID / 包名 | `dsh-ide-codeintel` |
| core 的 Cordis patch id | `ide-workbench` |
| codeintel 的 Cordis patch id | `ide-codeintel` |
| core 的 HTTP 前缀 | `/ide-workbench/api/`（**不变**） |
| core 的终端 WS | `/ide-workbench/ws/terminal`（**不变**） |
| codeintel 的 HTTP 前缀 | `/dsh-codeintel/api/` |
| codeintel 的 LSP WS | `/dsh-codeintel/ws/lsp` |
| core 的设置文件 | `<profile>/ide-workbench/settings.json` |
| codeintel 的设置文件 | `<profile>/dsh-codeintel/settings.json` |
| 宿主侧服务名 | `dsh-ide-workbench.contract`（`HOST_SERVICE`） |
| CodeMirror 运行时的全局键 | `Symbol.for('dsh.ide-workbench.codemirror')` |
| 故障注册表的全局键 | `Symbol.for('dsh.ide-workbench.fault-registry')` |

---

## 2. 宿主侧契约（core 提供 → codeintel 消费）

core 的 `apply(ctx)` 里：

```js
ctx.provide(HOST_SERVICE, {
  version: CONTRACT_VERSION,
  getProjectRoot: () => store?.state?.root ?? '',
  getScopeRoot: () => store?.state?.scopeRoot ?? '',
  readFile: (absolutePath) => call('fs.read', { root: getProjectRoot(), path: absolutePath }),
  searchFiles: (opts) => call('fs.search', { root: getProjectRoot(), ...opts }),
  onProjectChanged: (cb) => { /* 订阅 root 变化 */ return unsubscribe },
  health: () => ({ ok: true }),
})
```

**消费方必须软取**：`const core = ctx.get(HOST_SERVICE)`——**不得**用 `inject: [HOST_SERVICE]`，否则 core 缺席时 codeintel 永不 `apply`，用户连引导都看不到（PRD §3.2 的警告）。

**版本协商**（PRD §3.1，逻辑固定）：

| 情况 | codeintel 的行为 |
|---|---|
| `core.version === CONTRACT_VERSION` | 正常 |
| `core.version > CONTRACT_VERSION` | 只用 major 相同的能力，其余按「不可用」处理 |
| `core.version < CONTRACT_VERSION` | **拒绝启用**，设置页与 toast 提示「请升级 IDE 工作台插件」 |
| `core === undefined` | **降级模式**（DEG-01 / DEG-02） |

---

## 3. 客户端契约（core 声明槽位 → codeintel 注册）

### 3.1 core 声明

```js
ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: 'dsh-ide-workbench',
  children: {
    [SLOT_KEYS.editorBridge]:    { kind: 'single', scope: 'session' },
    [SLOT_KEYS.statusItem]:      { kind: 'list',   scope: 'session' },
    [SLOT_KEYS.settingsSection]: { kind: 'list',   scope: 'session' },
    [SLOT_KEYS.commandItem]:     { kind: 'list',   scope: 'session' },
  },
}, Workbench)
```

### 3.2 渲染点与投递的 prop

| 渲染点 | 槽位 | prop |
|---|---|---|
| 编辑器区（与 `CodeEditor` 同层） | `editorBridge` | `{ contract }` |
| 状态栏右侧 | `statusItem` | `{ contract }` |
| 设置页 | `settingsSection` | `{ contract }` |
| 编辑器右键菜单 | `commandItem` | `{ contract }` |

**`contract` 对象的形状（写死）**：

```js
{
  version: CONTRACT_VERSION,
  editor: EditorSeam,     // 见 packages/contract/src/client-api.d.ts
  host: WorkbenchHostApi, // 客户端侧的同构视图，由 core 实现
}
```

### 3.3 codeintel 注册（顺序无关）

```js
ctx.effect(() => ctx.slots.inject(SLOT_KEYS.editorBridge, () =>
  ctx.slots.register({ name: SLOT_KEYS.editorBridge, id: 'dsh-ide-codeintel' }, CodeIntelBridge)),
  'dsh-ide-codeintel: editor bridge')
```

---

## 4. 编辑器接缝（`EditorSeam`）

签名见 `packages/contract/src/client-api.d.ts`。core 侧实现要点：

| 能力 | core 的实现 |
|---|---|
| `registerExtensions(provider)` | 收集各 provider 的 `ExtensionSlot[]` → `mergeExtensionSlots()` → 装进 `extensionCompartment`（**原 `lspCompartment` 改名**）；`refresh()` 触发 `compartment.reconfigure` |
| `registerKeymap(entries)` | 并入 `editorKeymapRest()` |
| `registerCommands(items)` | 并入编辑器右键菜单 |
| `onDocument(cb)` | tab 变化 / 文档变更时广播 `DocumentInfo` |
| `reveal(path, line, column)` | 复用现有的 `revealPosition` / `revealColumn` |
| `codemirror` | core 独占的 CodeMirror 运行时（见 §5） |

### 4.1 扩展槽位与让位（CTR-06，规则写死）

```
1. core 与 codeintel 各自提供 ExtensionSlot[]；
2. 按 key 分组；
3. 同 key 取 priority 最大者；priority 相同则**后注册者胜**；
4. 被挤掉的槽位**不装进 Compartment**；
5. 合并结果在每次 refresh() 时重算。
```

| 声明方 | 槽位 |
|---|---|
| core | `{ key: 'closeBrackets', priority: CORE_PRIORITY (0), extensions: [closeBrackets(), closeBracketsKeymap] }` |
| codeintel | `{ key: 'closeBrackets', priority: CODEINTEL_PRIORITY (100), extensions: [closeBrackets(), closeBracketsKeymap] }`<br>`{ key: 'autocomplete', priority: 100, extensions: [autocompletion({...})] }`<br>`{ key: 'lsp', priority: 100, extensions: lspExtensions() }` |

⇒ **只装 core**：有自动闭合括号，**无任何补全**。
⇒ **双装**：`closeBrackets` 由 codeintel 生效，core 让位；**生效方与加载顺序无关**。

---

## 5. CodeMirror 单实例（方案 B，已由 spike S1 证实）

- **core 独占** `@codemirror/{state,view,language,autocomplete,lint,commands,search}`，并在**模块求值期**发布运行时：

  ```js
  globalThis[Symbol.for('dsh.ide-workbench.codemirror')] = { state, view, language, autocomplete, lint, commands, search }
  ```

  同时通过 `contract.editor.codemirror` 交付。

- **codeintel 不打包任何 `@codemirror/*`**：构建时用 esbuild `alias` 指向 `src/client/vendor/cm-<name>.js`。
- **shim 必须是 ESM 的「惰性 Proxy」**（不是 PRD §3.5.3 草稿里的 CJS `module.exports = new Proxy`）：

  > 原因（实测）：esbuild 把 CJS 模块转成 ESM 命名空间时用 `__copyProps`，它**只复制 `ownKeys` 能列出的键**；一个只有 `get` 陷阱、没有 `ownKeys` 陷阱的 Proxy **一个键都列不出来** ⇒ 命名导入全是 `undefined`。ESM shim 每个导出一个**具名惰性 Proxy**（`lazyProxy(namespace, name)`）才可用。

- **惰性**：Proxy 在**属性访问时**才解析运行时 ⇒ codeintel 单独安装时**物化期不抛错**（DEG-01 的前提），只有真正使用编辑器能力时才抛出可捕获的错误。

---

## 6. 故障隔离（ISO-01 / ISO-02）

- 归属判定**只有一处实现**（`packages/contract/src/fault-registry.js`，两包各带一份，靠 `Symbol.for` 共享）：
  1. 栈命中某个已声明的 owner 目录 ⇒ 交给该 owner 的 `onFault`；
  2. 都不命中 ⇒ 交给宿主原有的处理器（fail-loud 策略不变）。
- **全进程只装一个** `uncaughtException` / `unhandledRejection` 处理器（`installFaultBoundary` 幂等）。
- 每个插件声明自己的源码目录为 owner：
  - core：`claimFaultOwnership(<core 的 src 目录>, onCoreFault)`
  - codeintel：`claimFaultOwnership(<codeintel 的 src 目录>, onCodeintelFault)`——**codeintel 的异常不杀宿主、不掀翻 core**。
- core 的 LSP 专属分支（`lsp.transition(root, 'degraded', …)`）**随 codeintel 走**。

---

## 7. 设置迁移（MIG-01）

- core：`SETTINGS_VERSION` 由 **5 → 3**（换了文件格式，不是倒退），迁移函数**显式丢弃** `lsp` 段与 4 个语义快捷键（**但不删**旧文件里的该段 ⇒ 降级旧版仍可用）。
- codeintel：独立 `SETTINGS_VERSION`（从 1 起），文件 `<profile>/dsh-codeintel/settings.json`，内容 = `lsp` 段 + 4 个语义快捷键 + 索引记忆 + 内存预算。
- **一次性导入**：codeintel 首次启动时读 core 的设置文件，把 `lsp` 段与 4 个快捷键搬进自己的文件，并标记「已导入」（`codeintel.legacyImported` 之类）。

---

## 8. 构建与发版

| 包 | 客户端产物 | 宿主产物 |
|---|---|---|
| `packages/workbench` | `dist/client.js`（esbuild；external: `react`, `@deepseek-ai/dsh-client-ui-primitives`） | `src/index.js` + `src/host/**` |
| `packages/codeintel` | `dist/client.js`（esbuild；**alias** `@codemirror/*` → shim；external 同上） | `src/index.js` + `src/host/**`（**必须含 `lsp-worker.js`**） |

- 两个包**独立版本线**：core `0.6.0`，codeintel `0.1.0`。
- `dsh.plugin.json.version` 与 `package.json.version` 必须一致。

---

## 9. 机械验收（脚本可查）

| # | 验收项 | 机械证据 |
|---|---|---|
| R5 | 无跨包越界 import | core 的 `src/` 不含任何 codeintel 符号；反之亦然 |
| R6 | core 无代码智能残留 | core 的 `src/` 里 grep `lsp` / `autocompletion(` / `@codemirror/lsp-client` ⇒ **零命中**（白名单：`closeBrackets` / `closeBracketsKeymap`） |
| R7 | core 无语言服务器依赖 | `packages/workbench/package.json` 无 `typescript` / `basedpyright` / `yaml-language-server` / `typescript-language-server` |
| R8 | core 无补全能力 | core 的 `src/` 里**没有** `autocompletion(` 的调用 |
| ISO-03 | core 进程树无语言服务器 | core 的 `src/` 不 import 任何语言服务器模块 |

---

## 10. Spike 结论（M2）

| # | 结论 |
|---|---|
| **S1** | ✅ **通过**（实测，见 `tests/contract-codemirror.test.mjs`）。ESM 惰性 Proxy shim 可行；CJS Proxy 草稿**不可行**（`ownKeys` 陷阱缺失 ⇒ 命名导入丢失）。codeintel 单独安装时**物化期不抛错**，未绑定时抛**可读**错误。`instanceof` 跨边界**成立**。 |
| **S2** | ✅ 槽位跨插件注册：`ctx.slots.inject` 语义已核实（声明已存在则同步执行，否则在声明提交时执行）⇒ **加载顺序无关** |
| **S3** | ✅ 宿主侧服务总线：`ctx.provide` / `ctx.get`（非 strict）可用 |
| **S4** | ✅ 第二插件的宿主能力：`ctx.webServer.register` / `registerUpgrade` / `ctx.subprocess.spawn` / `ctx.connection.requestRejection` 对第二个插件同样可用 ⇒ **codeintel 完全自治** |

### 10.1 S2 的三个附带事实（实测于本机 `dsh@0.2.0-rc.2`）

1. **子槽位由 `register()` 的 `children` 表声明**；同一个 child key 被声明两次会抛
   `slot "X" is already declared`。
2. **渲染子槽位用组件 props 上的 `renderSlot(key, owner, opts)`**；key 必须在**该 entry 的
   `children`** 里，否则抛 `SlotOwnershipError`。`owner` 就是占用方收到的 props —— 契约
   `{ contract }` 从这里走。
3. **槽位种类的要求**：`list` 必须给 `options.id`；`single` 在同一优先级不得有两个占用方；
   `chain` 用 `renderSlotChain`。

### 10.2 S1 的两处落地修正

1. **shim 必须是 ESM 的具名惰性 Proxy**，不是 CJS 的 `module.exports = new Proxy(...)`：
   esbuild 把 CJS 模块转成 ESM 命名空间时用 `__copyProps`，它只复制 `ownKeys` 能列出的键；
   没有 `ownKeys` 陷阱的 Proxy **一个键都列不出来** ⇒ 命名导入全是 `undefined`。
2. **`@codemirror/lsp-client` 必须用动态 `import()` 加载**：静态 import 会在包**物化期**执行
   库的模块体，而那段代码碰到 `@codemirror/state`（已被别名到 shim）⇒ shim 在未绑定时抛错 ⇒
   **单独安装 codeintel 将完全装不上**（B1 破）。

### 10.3 产物级的机械证据（`npm run verify:split`）

| 断言 | 证据 |
|---|---|
| 页面上只有一份 `@codemirror/state` | core 的 `dist/client.js` **含** `@codemirror/state` 的源码标记，codeintel 的**不含** |
| codeintel 单独装得起来 | 把 codeintel 的 `dist/client.js` 塞进**没有 CodeMirror 运行时、没有 DOM** 的沙箱加载：**不抛错** |
