# 全项目查找与文件树查找的稳定性修复（FIND-03 / FIND-04 / FIND-05）

> 实施记录，不是规格。规格仍以 `docs/prd/v8/PRD-v8.md` 为准；本文只写这次修复**做了什么**、
> **为什么**、以及**证据在哪里**。
>
> 标注约定：**读码确认** = 从源码读出来的结论（带 `file:line`）；
> **实测确认** = 本机跑出来的数字（带探针脚本与命令）；
> **推断** = 没有直接测量、但由代码路径推出的结论。

## 0. 症状与范围

用户报告：全项目查找（`Ctrl+Shift+R`）与文件树的文件筛选在**大仓库 / 活跃工程**里
「失效」「不稳定」。本轮修的是**宿主半边**（`src/host/**`）的查找链路，外加客户端的
两处（弹窗的诚实展示、文件树展开的并发上限）。

修完之后的四条不变式：

| 不变式 | 落点 |
|---|---|
| ① 被放弃的扫描必须**停下**（子进程也停） | `src/host/git.js:64`（`runGit` 接 `signal`） |
| ② 超时**不是错误**：换下一条路径；部分答案必须说自己是部分的 | `src/host/search.js:865` / `:772` / `:1040` |
| ③ 三条路径回答**同一个问题**（同样的文件、同样的过滤、同样的命中） | `src/host/search.js:327`（`pathFilter`）、`src/host/scanner.js:81`（`parseScanRecord`） |
| ④ 答案里不能有「被静默截断」 | `src/host/search.js:344`（文件索引封顶并报 `truncated`）、`src/client/SearchPopup.jsx:284` |

---

## 1. 根因与修复

### FIND-03-1　git 路径完全无视 abort：每次敲键都留下一棵 `git grep`（读码确认）

* 客户端每次敲键都会放弃上一次扫描：`src/client/store.js:1983`（`runSearch`）调
  `this.searchAbort.abort()`，HTTP 请求随之关闭，宿主把 `request.signal` 交给
  `searchFiles`（`src/index.js:373-387`，本轮未改）。
* **但是** git 路径把 signal 丢了：`searchWithGit` 调 `runGit(env, base, { allowFailure: true })`，
  既没有 `signal`，`runGit` 当时也不认识 `signal`。于是 `git grep --untracked` 会把
  整个工作树扫完（实测：本机 3000 文件仓库里一次完整 git 路径 300–400 ms；仓库越大越久），
  上限是 `runGit` 自己的 30 s 超时。**读码确认**（修复前的 `src/host/search.js` 的
  `searchWithGit`）。
* 修复：
  * `runGit` 新增 `signal` 与 `onLine` 两个选项（`src/host/git.js:64`）。abort 时**立刻**
    kill 子进程并 resolve（`aborted: true`），不等管道关闭——孙进程会持有管道，
    等管道等于让这次扫描再活 30 s；
  * `searchWithGit` 把 `options.signal` 透传给 `runGit`（`src/host/search.js:865`）；
  * abort 之后**不再往下退**到 scanner/walk（没有读者了）。

### FIND-03-2　git 超时把整次查找变成 504（读码确认）

* `runGit` 超时会 `reject(new ApiError('git-timeout', …, 504))`（`src/host/git.js:93`）。
  `allowFailure` 只容忍**非零退出码**，不容忍超时。
* 修复前 `searchWithGit` 与 `listFiles` 都没有 catch → 一次 git 超时会让
  **整个查找报错**（用户看到 "git grep timed out after 30000ms"，而不是结果）。
* 修复：`searchWithGit` catch 住超时并 `return null`（交给下一条路径），
  `listFiles` catch 住超时并退回 walk（`src/host/search.js:344`）。
  **用户可见变化**：大仓库里 git 慢时不再报 504，而是换路径继续给出答案。

### FIND-03-3　scanner 超时后回落到**更慢**的 walk（读码确认）

* 修复前 `searchWithScanner` 超时返回 `null` → `searchFiles` 落到 `searchWithWalk`。
  walk 是三条路径里最慢的（实测 3000 文件 ≈ 1.1 s vs ripgrep ≈ 0.3 s），
  所以「超时」反而让查找**更慢**，而且用户看不到任何提示。
* 修复：超时返回一个**部分答案**并带 `timedOut`（`src/host/search.js:772`），
  `searchFiles` 不再因此回落到 walk（`src/host/search.js:1040`）。
  **用户可见变化**：超时的查找给出「已找到的部分 + 结果已截断」，而不是继续卡住。

### FIND-03-4　整个查找没有时间预算（读码确认 + 实测确认）

* 修复前：git 路径 30 s（`READ_TIMEOUT_MS`）+ scanner 30 s（`SCANNER_TIMEOUT_MS`）+ walk 不限时。
* 修复：查找有 30 s 的总预算（`SEARCH_TIMEOUT_MS`，`src/host/search.js:79`）；
  git 路径最多 10 s（`GIT_TIMEOUT_MS`，`src/host/search.js:88`，比 ripgrep 慢，
  大仓库里让它早点把活交给 scanner）；walk 至少再给 5 s（`MIN_WALK_MS`，
  `src/host/search.js:90`），因为它是唯一总能回答的路径。

### FIND-04-1　git 路径输出整包缓冲后再 split（读码确认）

* 修复前 `runGit` 把 stdout 全攒进一个字符串（`git.js:97`），`searchWithGit` 再
  `result.stdout.split('\n')`。「到处都命中」的查询会产生几十 MB 的 stdout
  （旧 REPORT 的实测：20000 文件全命中时 git 路径 9.8 s，而 walk 只要 0.5 s）。
* 修复：`runGit` 新增 `onLine` 流式模式（`src/host/git.js:64`），输出逐行交给调用方；
  命中数到上限时回调返回 `false`，子进程当场被 kill —— 不再读、也不再存剩下的输出。

### FIND-04-2　同一查询在不同路径上答案不同（实测确认）

三个具体的不一致，**全部**已修：

1. **git 路径完全忽略 `exclude`**，而 scanner/walk 会应用它；
2. `include` 非空时 git 路径会**丢掉** `DEFAULT_EXCLUDES`（修复前
   `src/host/search.js` 的 `if (include.length > 0) … else base.push(...DEFAULT_EXCLUDES)`）；
3. 噪声目录（`dist/`、`node_modules/` …）在 walk 里是**任意深度**跳过的，
   在 git 路径里只排除**仓库根**那一层。

修复：三条路径共用同一个过滤器 `pathFilter`（`src/host/search.js:327`），
噪声目录按目录名任意深度判断（`isNoisePath`，`src/host/search.js:308`），
git 路径的 pathspec 也改成任意深度（`:(exclude,glob)**/dist/**`）。
用例：`tests/search-stability.test.mjs` 的
「the three paths answer the same files」「the git path applies the exclude filter, like the other paths」。

### FIND-04-3　`include`/`exclude` 只按前缀匹配，glob 形同虚设（读码确认 + 实测确认）

* 修复前是 `path.startsWith(prefix)`：`src` 会匹配 `src-old/a.ts`；
  而 `*.ts`、`src/**/*.ts` 这种写法**匹配不到任何东西**——用户以为 glob 可用，结果是空。
* 修复：`matchesPattern`（`src/host/search.js:269`）支持
  * 纯前缀（按**路径段**匹配：`src` 命中 `src/a.ts`，不命中 `src-old/a.ts`）；
  * glob（`*` 不跨目录、`**` 跨目录、`?` 一个字符）；
  * **不带分隔符的 glob 是「文件掩码」**：`*.ts` 命中任意深度的 `.ts` 文件
    （这正是用户在输入框里写的东西）。

### FIND-04-4　hit / context 行的判定依赖 pattern：正则方言一换，命中就被吞掉（实测确认）

* 修复前的判定（`src/host/scanner.js` 的 `parseScanLine`）：
  「只有当 pattern 的字节偏移 == 工具报的列号 - 1 时，这一行才算命中」。
  工具（`git grep -E`）用的是 **POSIX ERE**，pattern 用的是 **JS RegExp**：
  `\d` 在 JS 里是数字类、在 POSIX 里是字面量 `d`。
* **实测确认**（探针 `qa-sandbox/search-bench/probe-hit-matrix.mjs`，修复前）：
  查询 `\d+` 时 git 路径找到 **0** 个命中，而 walk 找到 5 个、ripgrep 找到 4 个；
  而且字节偏移对不上时，命中行会掉进 `CONTEXT_LINE` 分支，变成**路径与行号都错**的
  上下文行（`src/a.ts:3:5:const x = a-12-b` 会被读成 `src/a.ts:3:5:const x = a` 的第 12 行）。
* 修复：**不再让 pattern 参与判定**。
  * git 路径改用 `git grep -z`、scanner 改用 `ripgrep --null`：路径与行文之间用
    **NUL** 分隔，路径因此绝对可靠；
  * 记录（record）的**形状**决定它是命中还是上下文行
    （`path\0行\0列\0文本` / `path\0行\0文本` / `path\0行:列:文本` / `path\0行-文本`）；
  * 列号由工具的**字节偏移**换算成字符（`characterColumn`，`src/host/scanner.js:64`），
    不再依赖 pattern 的匹配位置。
  * 用例：`tests/search-scanner.test.mjs` 的「the parser knows a hit, a context line and the separator」
    「the column of a hit counts the characters, not the bytes」。
* **方言混用也一并去掉**：正则模式下 **git 路径不再参与**
  （`src/host/search.js:865`，`git grep -E` 的 POSIX 方言不是用户要的方言）。
  正则由 scanner（Rust regex）或 walk（JS RegExp）回答。

### FIND-05-1　文件索引（文件树查找的底座）会被 git 超时打死（读码确认）

* `fs.files` → `listFiles` → `git ls-files`；修复前超时直接 reject →
  路由报错 → 客户端 `fileIndexError` → **文件树的筛选彻底不可用**。
* 修复：`listFiles` catch 超时并退回 walk（`src/host/search.js:344`）；
  同时给文件索引加了上限（`MAX_FILES`）并在超出时**报 `truncated`**，
  不再让一个巨大仓库的索引把客户端淹了。

### FIND-05-2　文件树搜索一次敲键可能请求几百个目录（读码确认）

* `ProjectPanel` 把匹配链交给 `store.expandPaths`，修复前是
  `Promise.all(pending.map(path => this.loadDir(path)))` —— **并发无上限**。
  一个常见前缀可以匹配几百个文件、分散在几百个目录里。
* 修复：`expandPaths` 用固定并发（`EXPAND_CONCURRENCY = 8`，`src/client/store.js:47`）
  逐批加载（`src/client/store.js:1795` / `:1821`）。目录一个都不少，只是分批。
  用例：`tests/tree-search.test.mjs` 的
  「the tree search expands the folders of the matches with a bounded number of requests」。

### FIND-05-3　弹窗把「被截断」显示成「没有匹配」（读码确认）

* 修复前：结果为空且 `truncated === true` 时，弹窗显示「没有匹配」——一个**部分**答案
  被说成了「什么都没有」。
* 修复：`src/client/SearchPopup.jsx:284` 在这种情况下显示「结果已截断」。

---

## 2. 被**排除**的怀疑项（有证据，不是猜）

| 怀疑 | 结论 | 证据 |
|---|---|---|
| `git grep --column` 报的是**字符**不是字节 | **证伪** | 探针 `probe-git-columns.mjs`：`cjk.txt:1:13:你好世界needle` → 字节偏移；ripgrep 同为字节 |
| 非 ASCII 内容会让 hit 判定失效 | **证伪** | 同上：两个工具都是字节偏移，与 pattern 的字节偏移一致 |
| `ByteBudget.reserve` 不是原子的，会超发预算 | **证伪** | `src/host/search.js` 的 `reserve` 在 `await` 之后**重新检查**条件并**同步**自增，没有让出点；已有用例 `tests/search-perf.test.mjs`「the bytes in flight stay under the budget」钉住峰值 |
| 大 stdout 是主因 | **部分证伪** | 解析成本实测 12.8 ms（修复前）→ 11.7 ms（修复后），`probe-parse-cost.mjs`；真正的成本是 git 进程本身与**重复的扫描**（FIND-03-1） |
| `MAX_RESULTS` / `MAX_FILES` 静默截断 | **部分确认** | 命中数上限本来就报 `truncated`；但**文件索引**的上限修复前不报（已修，`listFiles`） |

---

## 3. 用户可见的行为变化

1. 大仓库里 git 慢时，查找**不再报 504**，而是换一条路径继续（读码确认）。
2. 超时/截断的查找会明确显示「结果已截断」，**不再显示「没有匹配」**（读码确认）。
3. 正则模式在仓库里**不再走 git 路径**（POSIX 方言），由 ripgrep 或内置 walk 回答（读码确认）。
4. `include`/`exclude` 支持 `*.ts`、`src/**/*.ts` 这类掩码/glob，且三条路径一致（读码确认）。
5. `include`/`exclude` 的前缀按**路径段**匹配：`src` 不再命中 `src-old/a.ts`（读码确认）。
6. 文件索引超过 5 万个文件时会被截断，答案里带 `truncated`（读码确认）。

---

## 4. 性能

* 闸门：`node --test tests/perf-hot-path.test.mjs tests/perf-cold-workspace.test.mjs
  tests/perf-notify.test.mjs tests/perf-slice-project.test.mjs tests/perf-slice-editor.test.mjs
  tests/perf-slice-git.test.mjs` → **50/50 通过**。
* 解析成本（实测，最小值）：旧 12.8 ms → 新 11.7 ms（3000 文件 / 291 KB 输出）。
* git 的 flag 成本（实测，交错取最小值）：旧 413 ms → 新 327–359 ms（**在噪声内**）。
* 被放弃的扫描（实测）：修复前 572 ms（整个扫描跑完）→ 修复后 **74–153 ms**（abort 即停）。

## 5. 遗留风险

* **全字匹配 + 非 ASCII 邻接**：ripgrep 的 `--word-regexp` 用 Unicode 词边界，
  JS 的 `\b`（无 `u` 标志）与 git 的 `-w` 用 ASCII 词边界 → 三条路径在这种行上仍会不同
  （实测：探针 `probe-path-agreement.mjs` 的 `whole-word` 一例，9 例中 8 例完全一致）。
  **推断**：把 JS 的 `\b` 换成 Unicode 属性类会给用户的正则加上 `u` 标志的语义变化
  （`\{` 之类转义会变成语法错误），风险大于收益，本轮不做。
* 文件索引被截断时，客户端**没有**单独提示（`fs.files` 的答案带 `truncated`，
  但客户端没有新的 slice 字段可放——`tests/perf-slice-project.test.mjs` 钉死了 slice 的字段表）。
  **读码确认**。
* 正则模式在没有 ripgrep 的机器上会退回 walk（大仓库里慢）。**读码确认 + 推断**。
* 本轮**没有**在真机（DSH + Chrome DevTools）上点过弹窗：改动集中在宿主半边与解析层，
  客户端只改了两处（弹窗文案条件、store 的展开并发）。**未实测**。
