# PRD-v5 代码检视报告（第八轮：`238668e` 复核）

> **范围**：`1dbc238` → `238668e`（1 个提交：`238668e`「让『总是索引』在恢复路径上也真的成立」）。
> **基线**：`1dbc238`。**对照物**：`docs/prd/v5/PRD-v5-代码检视报告-第七轮.md`（上一轮 R7-1 / O-1 / O-2）。
> **方法**：读代码 + **实跑验证**。`npm test` 实跑 **911 项 / 911 通过 / 0 失败**（上一轮 905，+6）；`npm run build` 绿，`dist/client.js` = **2,960.8 KiB**，重建后 `git status` 无变化 ⇒ **提交的产物与源码逐字节一致**；三个自建探针（写在 `%LOCALAPPDATA%\Temp\`，**不在仓库内**）复验恢复路径、toast/状态栏一致性与上一轮的按钮矩阵。
> **本次检视未修改任何源码**，本文件是本轮唯一产物。
> **检视日期**：2026-11-01。
> **重点关注**：① R7-1 的修法是否正确、两侧（宿主起服 / 客户端会话）是否说同一件事；② 被改写的回归测试是否真的守得住它想守的东西；③ 本轮是否引入了新问题。

---

## 0. 结论

### 0.1 一句话

**上一轮 3 条全部处置妥当：R7-1 按我建议的方案 A 修好（不弹框、只对"用户已经表达过意见"的项目起服），O-2 的测试改成了真正的行为断言，O-1 记下备查并给出了两条不改的理由——我复核后同意。本轮未发现新的缺陷。**

**新发现：0 条。**

### 0.2 上一轮 3 条的复核：3/3 全部处置

| 编号 | 第七轮结论 | 本轮复核 | 关键证据 |
|---|---|---|---|
| **R7-1** | `indexOnOpen: 'always'` 在恢复路径与切工作区路径上被忽略 | ✅ **已修（方案 A 被采纳）** | 新增 `#startLspForRestored(root)`（`store.js:1654`），在**启动恢复**（`:805`）与**切工作区**（`:1234`）两条路径上调用：只对 `indexOnOpen === 'always'`（普通起服）或**记住的内存答复 `'accepted'`**（强制起服）生效；`'ask'` 维持现状（**不弹框、不起**）；`lspIndexDecision(root) === 'conservative'` 的项目**仍然什么也不起**（用户拒绝过的事情，恢复路径不许替他做主）。起服成功后决策记为 `'build'`，客户端会话与 store 于是说同一件事。**探针实测五行**（见 §1.1）：决策、宿主起服次数、客户端会话三列**处处一致** |
| **O-2** | R6-5 那条 grep 测试守不住它想守的东西 | ✅ **已修（真行为断言）** | `tests/client-status-render.test.mjs`「the status bar and the toast agree about every host state」：对宿主**全部 11 种状态**各跑一次——**真实 store 的 toast 闸门**与**状态栏的 key**必须给出同一个答案。**我用探针独立复算了一遍**：11 种状态**全部一致，不一致数 = 0**（§1.2） |
| **O-1** | 状态栏按钮的身份会随客户端会话的状态翻转 | ✅ **已记下备查（不改），理由成立** | 实施记录 §3.14 给了两条不改的理由：① 让【重新连接】从会话一开始就存在 ⇒ 那时"重连"还不是准确的说法，而且它会把【重新建立索引】在**每一次正常的项目打开**里都藏掉（会话在服务器起来之前一直是 `'starting'`）；② 按钮标题解释不了"为什么刚才那个按钮不见了"。**我复核后同意**——这是打磨，不是缺陷 |

### 0.3 本轮新发现

**无。**

> **范围说明**：本轮我另外核了三项**已被 `docs/prd/v5.1/PRD-v5.1.md` 排期**的问题——工作区切换时的服务器生命周期（WS-01 / WS-02）、`force` 记忆的传染（MEM-10）、新工作区的默认态（WS-04）。按你的要求，**本报告不重复它们**；它们的状态与验收口径由 v5.1 规格负责。

### 0.4 总体判断

**这一轮是七轮里最小的一轮（客户端 1 个文件 + 测试 + 文档），也是最干净的一轮**：没有引入新机制，只是把"用户已经表达过意见"这件事补到两条漏掉的路径上。

两处值得记下的地方：

1. **R7-1 的修法与我的建议完全一致，而且边界划得比我提的更准**。我建议的是"只对 `'always'`（以及记住的 `'accepted'`）补一次起服"；他采纳了，并补上了两条我写进建议里的约束——**`'ask'` 不弹框**（DSH 一启动就弹框不可接受）与**`conservative` 仍然什么也不起**（用户拒绝过的事情，恢复路径不许替他做主）。后一条尤其重要：它保住了上一轮 P1-2 那条不变式（**恢复路径不会偷偷给用户起他明确拒绝的服务器**）。
2. **O-2 改成了行为断言，而且改得比我建议的更狠**。我建议的是"断言两个模块导出的是同一个数组对象"或"对 11 种状态各跑一次两边"；他选了后者，并且**用了真实的 `WorkbenchStore`**（不是替身）来算 toast 那一半 ⇒ 这条用例现在真的守住了"状态栏与 toast 不会打架"这件事本身。他还在实施记录里写了验证方式（"把 store 的闸门换成另一份清单 ⇒ 变红；把常量改名 ⇒ 不变红"）——**守的是行为，不是拼写**，这正是我想要的那条断言。

---

## 1. 上一轮 3 条的修复复核（证据）

### 1.1 R7-1 —— 恢复路径现在按"用户已经表达过意见"起服

**实现**（`src/client/store.js`）：

```js
// #runInit（启动恢复，:801 之后）与 #switchWorkspace（切工作区，:1234 之后）
void this.#startLspForRestored(projectRoot)
```

```js
async #startLspForRestored(root) {
  if (typeof root !== 'string' || root === '') return
  const lsp = this.state.settings?.lsp
  const always = … && (lsp.indexOnOpen ?? 'ask') === 'always'
  const accepted = this.#memoryAnswer(root) === 'accepted'
  if (!always && !accepted) return          // 'ask' 维持现状：不弹框、不起
  if (this.lspIndexDecision(root) === 'conservative') return   // 用户拒绝过的，仍然不起
  this.#rememberIndexDecision(root, 'build')                    // 两边说同一件事
  await this.#startLsp(root, { force: accepted })
}
```

**探针实测**（`%LOCALAPPDATA%\Temp%\probe_r8_restore.mjs`，真实 `WorkbenchStore` + 真实 `init()`，三列分别来自 store、宿主调用记录与客户端会话模块）：

```
indexOnOpen=always         决策=build        宿主起服=1 客户端会话=有 socket=1
indexOnOpen=ask            决策=unknown      宿主起服=0 客户端会话=有 socket=2
indexOnOpen=never          决策=conservative 宿主起服=0 客户端会话=无 socket=2
记住 accepted（indexOnOpen=ask） 决策=build        宿主起服=1 客户端会话=有 socket=3
always + 记住 conservative   决策=conservative 宿主起服=0 客户端会话=无 socket=3
```

五行读下来，三件事同时成立：

- **`'always'` 真的生效了**：宿主被要求起服（1 次），**而且客户端会话也建起来了**（socket +1）——这两半必须同时发生，否则会变成"服务器起来了但没人跟它说话"或"客户端在等一个不会来的服务器"。仓库里的用例只验了第一半（宿主调用），**第二半是我补验的**。
- **`'ask'` 一行没变**（决策仍是 `'unknown'、不起服、不弹框）——"启动就弹框"这个风险确实没有发生。
- **`'never'` 与 `'always' + conservative` 两行都落到 `conservative`**：不起服、**连客户端会话都没有** ⇒ 用户拒绝过的项目，恢复路径不会替他做主 ✅（上一轮 P1-2 的不变式保住了）。

**宿主侧的闸门仍然生效**：起服走的是普通的 `lsp.start`（`force` 只在"记住的 accepted"时为 true），所以硬下限永远拒绝、tight 档要用户自己去点【重新建立索引】——这一条与上一轮 P2-3 的修法一致 ✅。

**新增回归用例**（`tests/store-lsp-decision.test.mjs`，+6 例）覆盖了：`'always'` 起服且 `force=false`、切工作区起服、`'ask'` 不起服**且不弹框**（断言 `state.indexDecision === null`）、`'never'` 不起服、记住的 `'accepted'` 起服且 `force=true`、`'always'` + 记住的 `'conservative'` 不起服。**六种组合都锁住了** ✅。

### 1.2 O-2 —— 那条测试现在守的是行为

**探针独立复算**（`%LOCALAPPDATA%\Temp%\probe_r8.mjs`，不依赖仓库里的那条用例，自己把两半各算一遍）：

```
宿主 idle        toast=不弹  状态栏=idle          红=否  ✅一致
宿主 disabled    toast=不弹  状态栏=disabled      红=否  ✅一致
宿主 degraded    toast=不弹  状态栏=degraded      红=否  ✅一致
宿主 crashed     toast=不弹  状态栏=crashed       红=否  ✅一致
宿主 suspended   toast=不弹  状态栏=suspended     红=否  ✅一致
宿主 cancelled   toast=不弹  状态栏=cancelled     红=否  ✅一致
宿主 failed      toast=不弹  状态栏=failed        红=否  ✅一致
宿主 starting    toast=弹    状态栏=sessionFailed 红=是  ✅一致
宿主 building    toast=弹    状态栏=sessionFailed 红=是  ✅一致
宿主 ready       toast=弹    状态栏=sessionFailed 红=是  ✅一致
宿主 restarting  toast=弹    状态栏=sessionFailed 红=是  ✅一致

不一致的状态数 = 0
```

⇒ **"会话死了"只在宿主声称没事时既弹 toast 又变红**——两根支柱说同一句话，11 种状态全部一致 ✅。

### 1.3 O-1 —— 我同意不改

实施记录 §3.14 给的两条理由我都核过：

- 理由①（【重新连接】不能从会话一开始就存在）**成立**：客户端会话在服务器起来之前一直是 `'starting'`，若那时就显示【重新连接】，【重新建立索引】会在**每一次正常的项目打开**里被藏掉——那才是真的把出口藏了。
- 理由②（按钮标题解释不了"为什么刚才那个按钮不见了"）**成立**：一个标题说不清一个会变的身份。

⇒ 记下备查是对的。

---

## 2. 本轮新发现

**无。**

本轮我把三样东西都重新算了一遍，都没有发现可动作的缺陷：

| 检查面 | 结果 |
|---|---|
| 恢复路径与切工作区路径的**起服条件** | `'always'` / 记住的 `'accepted'` 起服；`'ask'` / `'never'` / `'conservative'` 不起 ✅ 决策与 store 一致 |
| **两侧是否说同一件事**（宿主起服 ↔ 客户端会话） | 五种组合全部一致 ✅（探针三列对照） |
| **宿主侧的闸门** | 硬下限永远拒绝、tight 档只在"用户已答过"时跳过 ✅ 与 P2-3 的修法一致 |
| **被改写的既有测试** | 断言形状未削弱：把 `'ask'` 那一行的期望从 `'nav.semanticSessionUnavailable'` 改成 `'nav.semanticSessionConnecting'`，是因为**语义真的变了**（会话在 `'starting'` 时不再是"未就绪"而是"正在连接"），并写明了原因 |
| **新增的 6 条用例** | 六种策略组合全部锁住，含"不弹框"这条 |
| **构建产物** | `dist/client.js` = 2,960.8 KiB，重建后 git 无变化 ⇒ 与源码逐字节一致 |

---

## 3. 这一轮做得好、值得保留的地方

1. **R7-1 的修法与建议一致，边界还更准**（§1.1）。特别是**`conservative` 的项目在恢复路径上仍然什么也不起**——这一条保住了上一轮 P1-2 的核心不变式，而且它是我在建议里写成"store 的决策有最后发言权"的一句。
2. **`'ask'` 的保守处理是对的**：不弹框、不起、**也不把决策记成 `'build'`**（决策仍是 `'unknown'`）⇒ 状态与行为都没有被这一轮偷偷改变。
3. **O-2 改成了行为断言，用的是真实的 `WorkbenchStore`**（§1.2）——不是替身、不是 grep ⇒ 这条用例第一次真的守住了它想守的东西。
4. **O-1 不改并写明了两条理由**，而不是"先放着以后再说"。这种"我考虑过、但决定不改、理由是……"的记法，比默默跳过有用得多。
5. **新增用例覆盖了六种策略组合**（含"记住的 accepted ⇒ force=true"与"'always' + 记住的 conservative ⇒ 不起"），**没有只测 happy path**。
6. **提交里的产物与源码逐字节一致**（重建后 git 无变化）。

---

## 4. 一处文档同步（不是缺陷）

`docs/prd/v5.1/PRD-v5.1.md` §0.5 维护着一张「本轮基线上**已落地**的相关变更」表（L1–L6），并把基线写成 `` `dsh-ide-workbench` = `1dbc238` ``。本轮的 `238668e` 落在那张表之后 ⇒ **该表需要补一行、基线需要改成 `238668e`**，否则 v5.1 的实施者读到的"已落地"清单会少一条。

（这一条**不是**缺陷，也不涉及 v5.1 排期的任何条目；只是规格里的一处基线数字需要跟上。）

---

## 5. 复现方法与探针说明

本轮三个探针**写在仓库外的临时目录**（`%LOCALAPPDATA%\Temp\`），**没有进仓库**：

| 探针 | 验证的条目 | 输出要点 |
|---|---|---|
| `probe_r8_restore.mjs` | R7-1 | 五种策略组合下的「决策 / 宿主起服次数 / 客户端会话」三列对照 |
| `probe_r8.mjs` | O-2 | 11 种宿主状态下 toast 闸门与状态栏 key 的一致性 |
| `probe_r7.mjs`（沿用） | 上一轮的出口按钮矩阵 | 宿主 11 态 × 客户端 3 态的按钮矩阵（未回退） |

```sh
# 仓库与提交
git -C dsh-ide-workbench log --oneline -6
git -C dsh-ide-workbench status --short
git -C dsh-ide-workbench diff 1dbc238 238668e --stat

# 测试与构建（911 / 911；产物与源码一致）
npm --prefix dsh-ide-workbench test
npm --prefix dsh-ide-workbench run build
git -C dsh-ide-workbench status --short      # 重建后应当没有 dist 的改动

# 探针（脚本在 %TEMP%，不在仓库）
node "$env:TEMP\probe_r8_restore.mjs"
node "$env:TEMP\probe_r8.mjs"
node "$env:TEMP\probe_r7.mjs"
```

---

## 6. 一句话总结

**上一轮 3 条全部处置妥当：R7-1 按建议修好且边界更准（`'ask'` 不弹框、`'conservative'` 仍然不起）、O-2 改成了真正的行为断言、O-1 记下备查并给出了成立的理由。** 本轮**未发现新缺陷**——恢复路径的起服条件、两侧的一致性、宿主闸门、被改写的断言、新增用例与构建产物，六样都重新算过一遍，都没有问题。
