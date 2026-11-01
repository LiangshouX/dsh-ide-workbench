# PRD-v5.1 附录 —— Java 语言服务器（jdtls）修复方案

> **用途**：把「Java 语言不 work」这个问题从现象追到根因，并给出可直接实施的修复方案。
> **状态**：**已实施**（`0.5.1` 未发布）。实现见 `src/host/java-runtime.js` + `src/host/lsp.js` + `src/client/store.js`；验收用例见 `tests/lsp-java-runtime.test.mjs`、`tests/lsp-java-routing.test.mjs`、`tests/lsp-java-shutdown.test.mjs`、`tests/client-lsp-language.test.mjs`，用户可见变更见 `CHANGELOG.md` 的「Java 语言服务器（jdtls）」。
> **基线**：`dsh-ide-workbench` HEAD `666065b` + 未提交改动（`src/host/lsp.js` +170/−64 等 12 个文件）。
> **行号说明**：下文引用的行号取自上述基线。实施时 `src/host/lsp.js` 已被改动，**请按函数名重新定位**，不要按行号。
> **与其它文档的关系**：本附录是新增条目，不改写 `PRD-v5.1.md` 的 WS / MEM / CONC 条目，也不占用 `PRD-v5-缺陷跟踪.md` 的 D 编号（那一份止于 D18）。本附录的条目统一编号 **JS-01 … JS-05**。

---

## 0. 一页速览

### 0.1 先回答那个问题：复用 IDEA 自带的运行时，可行 —— 已实测

用户手动装的 jdtls 和 JDK 21 都可以不用。**IDEA 2026.1.4 自带的 JBR 就是 OpenJDK 25.0.3**（含 `javac`，是完整 SDK），而 jdtls 1.63.0 恰好要 JavaSE 25 —— 两者正好对上。

实测（本机，2026-11-01）：

```
D:\ProgramFiles\Jetbrains\IDEA\IntelliJ IDEA 2026.1.4\jbr\release
  JAVA_VERSION="25.0.3"
```

用它启动 jdtls 1.63.0，一次跑通：

| 检查项 | 结果 |
|---|---|
| `initialize` 应答 | ✅ `JDT Language Server (Standard)` / `1.63.0-SNAPSHOT` |
| 能力项 | ✅ 26 项 |
| 工程状态 | ✅ `ProjectStatus: OK` → `ServiceReady: ServiceReady` |
| Maven 工程导入 + 索引 | ✅ `Refreshing '/demo/src/test/java'` |
| `textDocument/completion` | ✅ 返回 50 项（`SafeVarargs - java.lang`、`ScopedValue - java.lang` …，说明 JDK 系统库已解析） |

**所以：不需要再装 JDK 25，也不需要改 PATH 或 JAVA_HOME。**

> ⚠ **上面那个路径是「本机观察结果」，不是「实现要求」。**
> 插件**绝不能**把 `D:\ProgramFiles\Jetbrains\IDEA\IntelliJ IDEA 2026.1.4\jbr` 写进代码 ——
> 换台机器（IDE 装在别的盘、别的目录、Toolbox 装的、或者根本没装 IDEA）就废了。
> **必须靠「发现」拿到它**：去问 IDEA 自己（`jdk.table.xml`）、从 IDE 启动器反推、读环境变量。
> 完整的可移植发现算法见 **§3.1–§3.4**，这是本方案最容易做错的地方，也是最该先读的一节。

### 0.2 但「Java 不 work」的真正原因不是 JDK，是插件根本起不来 jdtls

JDK 只是第二道门。**第一道门在插件自己手里**：本插件当前构造出的启动命令，在任何机器上都不可能把 jdtls 跑起来 —— 实测必然 `ENOENT`（§1.2）。

用户看到的现象大致是：

```
语义分析：启动失败
the language server could not be started: spawn D:\ProgramFiles\Jetbrains\IDEA\jdtls-1.63.0\bin\jdtls ENOENT
```

而且 `lsp.servers` 那一页会把 java 报成**「已安装」**（`resolvedPath` 指向那个 `.py` 脚本），所以设置页看不出问题。

### 0.3 五个缺陷一览

| 编号 | 缺陷 | 严重度 | 谁负责 |
|---|---|---|---|
| **JS-01** | 插件构造不出能启动 jdtls 的命令行（脚本没有解释器） | **P0 致命** | 宿主 `lsp.js` |
| **JS-02** | JDK 版本：jdtls 1.63.0 要 JavaSE 25；插件不做 JDK 发现，且 `requires: 'JDK 21+'` 是错的 | **P0** | 宿主 `lsp.js` |
| **JS-03** | jdtls 的 `-data` 默认目录按「项目文件夹名」哈希 → 同名工程共用工作区，索引互相污染 | **P1** | 宿主 `lsp.js` |
| **JS-04** | 语言路由：混合仓库（有 `package.json` 又有 `pom.xml`）恒被判成 TypeScript，Java 服务器根本不会启动 | **P0** | 客户端 + 宿主 |
| **JS-05** | java 的内存估算（512 MB）与实际占用（≥1 GB）差一个量级，且 2048 MB 的上限根本没落到 JVM | **P1** | 宿主 `lsp.js` |

**JS-02 的实现有一条额外红线**：路径必须**被发现**，不能被写死（§3.1）。本机的
`D:\ProgramFiles\Jetbrains\` 并不是 `%ProgramFiles%\JetBrains\` —— 按标准路径扫在本机**一个 IDE 都找不到**，
所以「扫固定目录」这种做法本身就是错的。

### 0.4 本轮范围

* JS-01 / JS-02 / JS-03 / JS-05：宿主侧改动，集中在 `src/host/lsp.js`（建议新开 `src/host/java-runtime.js` 收敛）。
* JS-04：客户端传语言 + 宿主按语言起会话。
* **不做**：把 jdtls 打进插件（仍走「用户自己装」的路子）、jdtls 的工程导入策略（m2e / Gradle）调优。

---

## 1. 事实核实（先读，否则会重复造轮子）

### 1.1 本机 jdtls 的安装形态

```
JDTLS_HOME = D:\ProgramFiles\Jetbrains\IDEA\jdtls-1.63.0        （机器级环境变量）
机器级 PATH 含 %JDTLS_HOME%\bin

D:\ProgramFiles\Jetbrains\IDEA\jdtls-1.63.0\
  bin\jdtls        866 B   ← 首行 "#!/usr/bin/env python3"，**无扩展名的 Python 脚本**
  bin\jdtls.bat     40 B   ← "python "%~dp0/jdtls" %*" + pause
  bin\jdtls.py    5004 B   ← 真正实现（argparse + 起 JVM）
  config_win\config.ini     ← osgi.bundles / eclipse.application=org.eclipse.jdt.ls.core.id1
  plugins\org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar
  plugins\org.eclipse.jdt.ls.core_1.63.0.202610191322.jar
```

`bin/jdtls` 是**官方发行包**的布局（`bin/jdtls` → `bin/jdtls.py` → `bin/jdtls.bat`）。它**不是** `.exe`，也不是 npm 包。

### 1.2 复现一：插件当前的启动方式必然 ENOENT

插件的路径（`src/host/lsp.js`）：

1. `probePath(command)`（函数 `probePath`，基线 702 行）：在 Windows 上**只接受「无扩展名的文件 / `.exe` / `.com`」**，并明确拒绝 `.cmd` / `.bat` —— 注释写得很清楚：「a `.cmd` or `.bat` launcher cannot be spawned without a shell, and this plugin never uses a shell」。
2. 命中后 `argv` 的构造（函数 `#spawn`，基线 3336 行）：

```js
const argv = resolution.scriptPath !== null && resolution.scriptPath !== undefined
  ? [process.execPath, resolution.scriptPath, ...session.args]
  : [resolution.path, ...session.args]
```

`resolution.scriptPath` 只在 `resolveBundled()`（基线 681 行）命中 npm 包时才非空，而 `BUNDLED_PACKAGES`（基线 248 行）里只有 typescript / python / yaml，**没有 java**。于是 java 走的是第二分支：

```
argv = ["D:\ProgramFiles\Jetbrains\IDEA\jdtls-1.63.0\bin\jdtls"]
```

用**插件会构造出的完全相同的 argv** 实测四种启动方式：

| 方式 | 结果 |
|---|---|
| **A. `["…\bin\jdtls"]`（插件今天构造的）** | ❌ **`spawn …\bin\jdtls ENOENT`** |
| B. `cmd.exe /c …\bin\jdtls.bat` | ❌ 能打印 help，但卡在 `pause` 上（8 s 超时仍在跑） |
| C. `python …\bin\jdtls --help` | ✅ exit 0 |
| D. `java -jar …\org.eclipse.equinox.launcher_*.jar …` | ❌ 见 §1.3 |

A 失败的原因很直白：CreateProcess 遇到无扩展名的文件会去找 `jdtls.exe`，找不到就 `ENOENT` —— 一个 866 字节的 Python 文本文件不是 Win32 可执行文件。

**结论：这不是配置问题，是代码问题。** 换任何 JDK、装任何版本的 jdtls，java 这条路在当前代码下都走不通。

> 顺带说明：插件已有的「用解释器跑入口点」机制**只覆盖 JavaScript** —— `resolveBundled()` 取 npm 包的 `bin` 字段，再用 `process.execPath` 跑它（文件头注释里那段 Windows note）。jdtls 的入口是 **Python**，这套机制套不上。

### 1.3 复现二：JDK 版本 —— jdtls 1.63.0 要 JavaSE 25

`jdtls --validate-java-version` 报的错（日志 `configuration\1793544757690.log`）：

```
!ENTRY org.eclipse.core.filesystem 2 0 2026-11-01 22:52:39.281
!MESSAGE Could not resolve module: org.eclipse.core.filesystem [28]
  Unresolved requirement: Require-Capability: osgi.ee; filter:="(&(osgi.ee=JavaSE)(version=25))"
…
!ENTRY org.eclipse.osgi 4 0 2026-11-01 22:52:39.285
!MESSAGE Application error
!STACK 1
java.lang.RuntimeException: Application "org.eclipse.jdt.ls.core.id1" could not be found in the registry.
```

jdtls 1.63.0 = Eclipse 2026-10，其 bundle 全部要求 `osgi.ee=JavaSE 25`。用本机三个 JDK 分别实测：

| JDK | 位置 | 结果 |
|---|---|---|
| Java 8 | `IDEA\JDK1.8` | — |
| **Java 17** | `IDEA\JDK`（**= 现在的 `JAVA_HOME`**），也是 PATH 上的 `java` | ❌ `UnsupportedClassVersionError: class file version 65.0 … only recognizes up to 61.0` |
| Java 21 | `IDEA\jdk-21.0.12.1` | ❌ 启动器能加载，但 OSGi 解析失败，`exit 13`，`An error has occurred. See the log file …` |
| **Java 25.0.3** | `IDEA\IntelliJ IDEA 2026.1.4\jbr`（**IDEA 自带**） | ✅ 全部通过（§0.1） |

**`requires: 'JDK 21+'` 是错的。** 21 是**启动器脚本**的下限（`bin/jdtls.py`：`if java_major_version < 21: raise Exception("jdtls requires at least Java 21")`），不是发行包的下限。所以 `jdtls --validate-java-version` 能过、而真正的服务器起不来 —— 这个「校验通过」是假象。

`hintFor()`（基线 729 行）会把这句话显示给用户：

```
Install JDK 21+ and make sure "jdtls" is on PATH.
```

—— 照着做也没用，因为真正要的是 25。

### 1.4 复现三：`-data` 的默认目录会撞车

`bin/jdtls.py`：

```python
cwd_name = os.path.basename(os.getcwd())
cachedir = cachedir / 'jdtls'
jdtls_data_path = os.path.join(cachedir, "jdtls-" + sha1(cwd_name.encode()).hexdigest())
```

哈希的是**当前工作目录的文件夹名**。插件 spawn 时 `cwd = session.scopeRoot ?? entry.root`（`#spawn` 里 spec 的 `cwd`），于是哈希值 = **项目文件夹名**。

后果：`D:\a\app` 和 `D:\b\app` 两个不同的工程 → 同一个 jdtls 工作区 → 一个的索引污染另一个。插件必须显式传 `-data`。

### 1.5 复现四：混合仓库的语言路由

`detectLanguage(root)`（基线 741 行）按标记文件**顺序**判定：

```js
const markers = [
  ['typescript', ['tsconfig.json', 'jsconfig.json']],
  ['python', ['pyproject.toml', 'setup.py', 'requirements.txt']],
  ['yaml', ['docker-compose.yml', 'docker-compose.yaml']],
  ['java', ['pom.xml', 'build.gradle', 'build.gradle.kts']],
  …
]
```

`typescript` 排在第一位，而 `PROJECT_MARKERS` 里又有 `package.json` → **只要仓库里有 `package.json`，就判成 TypeScript**，哪怕它是 Java 仓库。

而客户端**从不**把语言告诉宿主：客户端 `store.js` 的 `#startLsp()` 发的是

```js
call('lsp.start', { root, force: options.force === true })
```

没有 `languageId` —— 尽管宿主的 `lsp.start`（`src/index.js`）**早就接受** `languageId`（`src/index.js` 的 `lsp.start` 分支里 `languageId: typeof payload?.languageId === 'string' ? payload.languageId : undefined`），而且客户端 `lsp-uri.js` 的 `languageIdForPath(path)` **早就能**从扩展名算出语言（`.java` → `'java'`）。

实机佐证 —— 用户当前的设置文档 `C:\Users\X-L-S\.dsh\ide-workbench\settings.json`：

```json
"indexedRoots": {
  "D:\\Code\\Node\\DSH-IDE-TOOLWINDOWS-ROOT\\qa-sandbox": {
    "at": 1793542802910,
    "languageId": "typescript"          ← 该目录下有 src\Demo.java、src\ToolUtils.java
  }
}
```

所以：**混合仓库里打开 `.java` 文件，Java 服务器根本不会启动** —— 这一条和 jdtls 本身无关，是路由问题。

> 补充：`qa-sandbox` 没有 `pom.xml` / `build.gradle`，即使路由修对了，jdtls 也会把它当「invisible project」导入（无构建文件），能给单文件补全，但没有工程级 classpath。真正的 Maven / Gradle 工程才有完整语义。

### 1.6 复现五：内存估算差一个量级

注册表里的 java 条目：

```js
java: {
  command: 'jdtls',
  args: [],
  languageIds: ['java'],
  memoryLimitMB: 2048,
  memoryBaselineMB: 512,      ← 实际是 ≥1 GB
  requires: 'JDK 21+',
}
```

* `MEMORY_LIMIT_AWARE`（基线 260 行）只有 `typescript-language-server`，所以 **2048 MB 这个上限对 jdtls 完全没有落到 JVM 上** —— jdtls 用它自己的 `-Xms1G` 起，堆上限随它便。
* `memoryBaselineMB: 512` 用来跟机器空闲内存比。jdtls 起来就是 `-Xms1G` + Eclipse 开销 + 索引，典型占用 **1.5–2.5 GB**。低估 4 倍 ⇒ 闸门放行 ⇒ 机器进 swap —— 正是 PRD-v5 §5.2 记录过的那类事故。

---

## 2. JS-01 —— 插件构造不出能启动 jdtls 的命令行（P0）

### 2.1 方案选择

| 方案 | argv | JVM 是不是插件的**直接**子进程 | 依赖 | 插件能控 `-Xmx` 吗 |
|---|---|---|---|---|
| **A. JVM 直启（推荐）** | `[java, -Declipse.application=…, -jar <equinox.launcher.jar>, -data <ws>]` | ✅ 是 | 只要一个 JDK | ✅ 直接加 `-Xmx` |
| B. Python + 官方脚本 | `[python, …\bin\jdtls, --java-executable <java>, -data <ws>]` | ❌ JVM 是**孙进程** | JDK **+ Python** | 只能间接 `--jvm-arg=-Xmx…` |

**推荐 A**，理由不是「少依赖 Python」，而是**内存模型**：

* 插件停服务器时只做 `handle.terminate()`（`#stopSession` 一带，基线 4653–4674 行），**没有杀进程树**的实现 —— 已核对 `src/host/` 下不存在 `taskkill` / 进程组 / detached 相关的进程树清理逻辑。
* 方案 B 下，插件杀掉的是 Python，JVM 变成孤儿。JVM 只能靠 stdin EOF 自己察觉后退出（异步、不保证），于是：空闲退出 / 内存压力释放阀（PRD-v5 §1.2、MEM-02、WS-03）**放出去的是一台还活着的 1–2 GB 的 JVM**，内存根本没回来。
* 方案 A 下 JVM 就是那个 handle，`terminate()` 直接命中，`waitForExit()` 等的是真的服务器。

**代价**：方案 A 要让插件知道 jdtls 的目录布局（配置目录 + equinox 启动器 jar）。这个布局在官方发行包里是稳定的：

```
<jdtlsRoot>\config_win\config.ini                        （Windows；Linux=config_linux，mac=config_mac）
<jdtlsRoot>\plugins\org.eclipse.equinox.launcher_*.jar
```

而且布局**可以从已解析出来的启动器路径反推**，不需要用户再配一个路径：

* `JDTLS_HOME` 环境变量（本机就有）；
* 或 `…\bin\jdtls` 的上两级（官方发行包布局）；
* 或新增设置项 `servers.java.jdtlsHome`（兜底）。

### 2.2 落地要点

1. **注册表新增一个「怎么起」的字段**（与 `command` 并列，语义写在 `LSP_REGISTRY` 的注释里）：

   ```js
   java: {
     command: 'jdtls',          // 保留：探测目标 + 设置页展示用
     args: [],
     launcher: 'java',          // 新增：这个服务器由 JVM 起，不是直接起 command
     languageIds: ['java'],
     memoryLimitMB: 2048,
     memoryBaselineMB: 2048,    // 见 JS-05
     requires: 'a JDK the installed jdtls accepts',
   }
   ```

   `launcher` 缺省 = 现在的行为（直接起 `command`）。这样 TS / Python / YAML **一行都不用改**。

2. **`#resolveServer()`（基线 3261 行）** 增加一个分支：`launcher === 'java'` 时返回 `{ path: <java 可执行文件>, jdtlsRoot, launcher: 'java' }`，而不是 `{ path, scriptPath }`。

3. **`#spawn()`（基线 3336 行）** 的 argv 构造增加第三个分支：

   ```js
   const argv = resolution.launcher === 'java'
     ? buildJavaArgv(resolution, session)      // 见 §2.3
     : resolution.scriptPath != null
       ? [process.execPath, resolution.scriptPath, ...session.args]
       : [resolution.path, ...session.args]
   ```

4. **`.bat` / `.cmd` 的处置**：`probePath()` 在 Windows 上继续拒绝它们（插件从不用 shell，这个纪律是对的）。但 `hintFor()`（基线 729 行）必须把话说清楚，不能再让用户去点那个 `jdtls.bat`：

   ```
   jdtls 的批处理启动器（.bat/.cmd）需要 shell，本插件不使用 shell。
   请指向 jdtls 的可执行文件，或安装 jdtls 的 .exe 版本。
   ```

5. **通用的「脚本需要解释器」兜底（P1，可选）**：若将来有别的脚本型服务器，建议再加一条通用规则 —— 读解析到的文件头两行，若是 `#!` 且指向 python，则 argv 前置一个 `probePath('python')` 找到的解释器。**本轮不必做**（java 走方案 A 已经不依赖 Python）。

### 2.3 JVM 参数（实测可用的那一套）

```
<java>
  -Declipse.application=org.eclipse.jdt.ls.core.id1
  -Dosgi.bundles.defaultStartLevel=4
  -Declipse.product=org.eclipse.jdt.ls.core.product
  -Dosgi.checkConfiguration=true
  -Dosgi.sharedConfiguration.area=<jdtlsRoot>\config_win
  -Dosgi.sharedConfiguration.area.readOnly=true
  -Dosgi.configuration.cascaded=true
  -Xms<min(1024, 上限)>m
  -Xmx<上限>m
  --add-modules=ALL-SYSTEM
  --add-opens java.base/java.util=ALL-UNNAMED
  --add-opens java.base/java.lang=ALL-UNNAMED
  -jar <jdtlsRoot>\plugins\org.eclipse.equinox.launcher_*.jar
  -data <每根独立的 jdtls 工作区>
```

**⚠ `-Xms` 必须跟着 `-Xmx` 一起下调。** jdtls 的启动器脚本写死了 `-Xms1G`；如果插件只加 `-Xmx512m` 而 `-Xms` 还是 1G，JVM 会以
`Initial heap size set to a larger value than the maximum heap size` 直接启动失败。上面用 `-Xms<min(1024,上限)>m` 就是为了这个。

> 实测确认：`ConnectionStreamFactory`（`org.eclipse.jdt.ls.core` 内）按 **端口 → 命名管道 → stdio** 的顺序选传输，所以 **stdio 是默认**，**不需要** `--stdio` 参数。

---

## 3. JS-02 —— JDK 自动发现（P0）

### 3.1 铁律：路径必须被发现，不能被写死

> **实现约束（本节最重要的一条）**：代码里**不得出现任何机器相关的绝对路径**。
> 不许写 `D:\ProgramFiles\Jetbrains\...`，不许写 `C:\Program Files\JetBrains\...`，
> 不许把「IDEA 装在 D 盘」「用户把 ProgramFiles 挪到了别处」当成事实。
>
> 本文所有 `D:\ProgramFiles\...` 都只出现在**「本机实测」**的说明里，是**观察结果**，不是**实现要求**。
> 换一台机器（Windows / macOS / Linux，IDE 装在任意盘符或任意自定义目录）都必须照样能用。

这不是洁癖，是**已经踩到的坑**。本机的 IDE 装在 `D:\ProgramFiles\Jetbrains\`（用户把 `ProgramFiles` 目录整体搬到 D 盘了），于是：

| 假设 | 本机实际情况 | 后果 |
|---|---|---|
| `%ProgramFiles%\JetBrains\` | `C:\Program Files\JetBrains\` —— **不存在** | 按标准路径扫，**一个 IDE 都找不到** |
| IDE 目录是 `<root>\<产品> <版本>\` | 本机 IntelliJ 是 `<root>\IDEA\<产品> <版本>\`（多一层厂商目录） | 只探一层 → **漏掉 IntelliJ 系** |

所以「按标准路径扫目录」这条路在本机**根本不成立**。真正 portable 的做法是：**去问操作系统或问 IDE 自己要绝对路径**。

### 3.2 候选来源（全部由环境派生）

| # | 来源 | 怎么拿到（**全部是环境变量或 IDE 自己写的文件**） | 本机命中 |
|---|---|---|---|
| 1 | `settings.lsp.servers.java.javaHome` | **新增设置项**，用户显式填（目录或 java 可执行文件路径） | — |
| 2 | `JAVA_HOME` | 环境变量 | v17 |
| 3 | PATH 上的 `java` | 环境变量 | v17 |
| 4 | **IDE 自己记的 JDK 登记表** | `%APPDATA%\JetBrains\*\options\jdk.table.xml` 里的 `<homePath>` | v17、v21 |
| 5 | **IDE 自带的 JBR** | 从 **IDE 的启动器路径**反推：`<ideHome>\bin\idea64.exe` → `<ideHome>\jbr\bin\java.exe` | **v25 ✅** |
| 6 | 兜底扫描 | **由环境变量派生**的根：`%ProgramFiles%\JetBrains`、`%ProgramFiles(x86)%\JetBrains`、`%LOCALAPPDATA%\JetBrains\Toolbox\apps`、用户设置里追加的根 | 本机 0 个 |

**选择规则**：显式设置（#1）> 其余候选里**版本最高**的那个。

为什么取最高而不是取第一个能用的：

* Java 向后兼容 —— 用 Java 26 跑 Java 25 编译出来的 bundle 没问题；反过来不行。
* 本机 `JAVA_HOME` 和 PATH 上的 `java` 都是 17，**「取第一个」必然取错**。
* 最低要求由 jdtls 自己决定（21 是启动器脚本的下限，25 是发行包的下限），插件不需要硬编码。

#### #4 —— IDE 自己写的 JDK 登记表

IntelliJ 会把用户配置过的 JDK 写进 `%APPDATA%\JetBrains\<产品><版本>\options\jdk.table.xml`：

```xml
<jdk version="2">
  <name value="17" />
  <type value="JavaSDK" />
  <version value="Oracle OpenJDK 17.0.8" />
  <homePath value="D:/ProgramFiles/Jetbrains/IDEA/JDK" />
</jdk>
<jdk version="2">
  <name value="corretto-21" />
  <homePath value="$USER_HOME$/.jdks/corretto-21.0.3" />
</jdk>
```

**这是最 portable 的来源之一**：`homePath` 是 **IDEA 自己写下来的绝对路径**，与 IDE 装在哪、装在哪个盘符、是不是 Toolbox 装的**完全无关**。

⚠ **两个实现细节**：

1. **必须展开 IDEA 的宏**。`homePath` 里会出现 `$USER_HOME$`（本机就是如此），要替换成 `os.homedir()`；`~/` 也要展开。
2. **它不包含 JBR**。IDE 自带的运行时是「隐式」的，不会出现在这张表里（实测本机表里只有 `17`、`corretto-21`、`Kotlin SDK` 三条，没有 JBR）。所以 JBR 只能靠 #5。

#### #5 —— 从 IDE 启动器反推 JBR（找到 JBR 的关键）

**不要去找 JBR，要去找 IDE。** IDE 的启动器几乎总在 PATH 上（或用户会在设置里填），而 JBR 就在 IDE 目录下的 `jbr\`：

```
<ideHome>\bin\idea64.exe        →  <ideHome>\jbr\bin\java.exe
<ideHome>\bin\webstorm64.exe    →  <ideHome>\jbr\bin\java.exe
```

**复用插件自己已有的能力**：`src/host/idea.js` 的 `resolveIdeExecutable(ide, configuredPath, options)` 已经在做「找 IntelliJ IDEA / WebStorm / VS Code 的可执行文件」这件事，并且支持：设置项里的显式路径 → PATH → `%ProgramFiles%` 扫描 → macOS `/Applications`。JDK 发现应当**直接复用它**，而不是另写一套。

> ⚠ **但不能盲信它的目录扫描**：`idea.js` 里的 Windows 分支只扫**平铺**布局
> `<ProgramFiles>\JetBrains\<匹配 /IntelliJ IDEA/i 的目录>\bin\idea64.exe`，
> **扫不到本机的 `<root>\IDEA\<产品> <版本>\` 布局**。本机能找到 IDEA 是因为 PATH 里有
> `D:\ProgramFiles\Jetbrains\IDEA\IntelliJ IDEA 2026.1.4\bin`。
>
> 所以 #5 的实现要求：
> * **先走 PATH**（`fromPath` 那条路，最可靠）；
> * 再走 `settings.idea.path`（用户显式填，最可靠）；
> * 最后才扫目录，且**必须同时试「平铺」和「多一层厂商目录」两种布局**。

#### #6 —— 兜底扫描（只是兜底）

根目录**必须由环境变量派生**，不能写死：

```
%ProgramFiles%\JetBrains
%ProgramFiles(x86)%\JetBrains
%LOCALAPPDATA%\JetBrains\Toolbox\apps
<用户在设置里追加的根>
```

每个根下**同时试两种布局**：

```
布局 A（平铺）：  <root>\<产品> <版本>\jbr\bin\java.exe
布局 B（厂商层）：<root>\<厂商>\<产品> <版本>\jbr\bin\java.exe
```

**不要做递归文件搜索** —— IDEA 的安装目录是 GB 级的，递归搜 `java.exe` 会很慢。按「产品目录走、只测固定路径」实测只要 **287 ms**。

> 本机 #6 命中 **0 个** —— 因为 `%ProgramFiles%\JetBrains` 指向 `C:\Program Files\JetBrains`，而 IDE 在 `D:\ProgramFiles\Jetbrains`。
> **这正好说明 #4 / #5 才是主力，#6 只是兜底。** 如果只实现 #6，这台机器上就找不到 JBR。

### 3.3 怎么读版本 —— 不起进程

每个 JDK 目录里都有 `release` 文件：

```
<jdkRoot>\release
  JAVA_VERSION="25.0.3"      ← JBR 25
  JAVA_VERSION="21.0.12.1"   ← 另一个 JDK
  JAVA_VERSION="17.0.8"      ← JAVA_HOME 指的那个
```

解析 `JAVA_VERSION="X"` 取主版本号即可 —— **比起一个 `java -version` 子进程快得多，也不受 `JAVA_TOOL_OPTIONS` 之类的干扰**。

（`java` 在 PATH 上时，JDK 根目录 = `dirname(dirname(java 可执行文件))`。）

### 3.4 实测：这套算法在本机的输出

按 §3.2 的六路来源跑一遍（本机实测）：

```
v25  bundled JBR (IDEA)          D:\ProgramFiles\Jetbrains\IDEA\IntelliJ IDEA 2026.1.4\jbr
v25  bundled JBR (WebStorm)      D:\ProgramFiles\Jetbrains\Webstorm\WebStorm 2026.1.4\jbr
v25  bundled JBR (PyCharm)       D:\ProgramFiles\Jetbrains\Pycharm\PyCharm 2026.1.4\jbr
v21  jdk.table.xml               C:/Users/X-L-S/.jdks/corretto-21.0.3
v17  JAVA_HOME                   D:\ProgramFiles\Jetbrains\IDEA\JDK
v17  PATH                        D:\ProgramFiles\Jetbrains\IDEA\JDK
v17  jdk.table.xml               D:/ProgramFiles/Jetbrains/IDEA/JDK

→ 选中：25  D:\ProgramFiles\Jetbrains\IDEA\IntelliJ IDEA 2026.1.4\jbr\bin\java.exe
```

**注意每一条路径都是「被发现」的，不是「被写死的」** —— `D:\ProgramFiles\Jetbrains\...` 只是**这台机器上发现结果碰巧长这样**。在别的机器上，同样的代码会得到别的路径，或者从 `jdk.table.xml` / PATH 拿到别的位置。

### 3.5 「到底要哪个版本」—— P0 先给清单，P2 再给精确值

P0（本轮）：发现到的 JDK **全部列出来**（路径 + 版本），在失败信息里给用户看。本机应该长这样：

```
jdtls 启动失败。找到的 JDK：
  17.0.8   D:\ProgramFiles\Jetbrains\IDEA\JDK
  21.0.3   C:\Users\X-L-S\.jdks\corretto-21.0.3
  25.0.3   D:\ProgramFiles\Jetbrains\IDEA\IntelliJ IDEA 2026.1.4\jbr
jdtls 1.63.0 需要 JavaSE 25。请在设置里指定 lsp.servers.java.javaHome。
```

P2（可选增强）：从 jdtls 安装目录里读出**精确**的要求版本 —— 读 `plugins\org.eclipse.*.jar` 的 `MANIFEST.MF` 里的 `Bundle-RequiredExecutionEnvironment: JavaSE-25`（需要写一个最小 zip 读取器，Node 只有 `zlib` 没有 zip 库），或者失败后读 equinox 写的日志（jdtls 会把日志路径打到 stdout：`An error has occurred. See the log file <path>`，日志里有 `osgi.ee … version=25`）。

**P0 不要为了这个精确值引入 zip 解析。** 「清单 + 手动指定」已经足够定位问题。

### 3.6 注册表的 `requires` 要改

```js
requires: 'JDK 21+',      →   requires: 'a JDK the installed jdtls accepts',
```

`hintFor()` 会照此生成提示。**不要**再写死一个版本号 —— jdtls 的要求随发行版变（本机 1.63.0 要 25，更老的 1.5x 只要 21），写死必然骗人。

---

## 4. JS-03 —— `-data` 按项目根隔离（P1）

### 4.1 位置

放在插件自己的 profile 目录下面，和 `settings.json` 同级：

```
<profileBase>\ide-workbench\settings.json                      ← 已有
<profileBase>\ide-workbench\lsp-workspace\<rootKey 哈希>\        ← 新增
```

`profileBase()`（`src/host/settings-store.js`）= `$DSH_PROFILE_DIR` → `$DSH_HOME` → `~\.dsh`。
目录名用 `rootKey(root)`（`lsp.js` 里已有的、大小写不敏感的路径键）再取哈希，避免 Windows 路径里的非法字符和长度问题。

### 4.2 为什么要自己给

见 §1.4：默认的 `sha1(basename(cwd))` 撞车。**必须显式传 `-data`**，否则同名工程互相污染索引 —— 而这类污染的表征是「跳转定义跳到另一个工程的同名类」，极难排查。

### 4.3 生命周期

* jdtls 的工作区目录是**持久**的（这是它的索引缓存），不要每次启动都清 —— 清了等于每次重建索引。
* 但它必须**按根隔离**，且旧的根（不再出现的工程）应由宿主在合适时机清理，否则会攒下一堆 GB 级的 Eclipse 工作区。
  * 建议：宿主在 `shutdownAll()` / 插件退出时，清理**不属于任何已知根**的孤儿目录。
  * 最低要求：**不要**在启动时无条件删目录。

---

## 5. JS-04 —— 语言路由（P0 + P1）

### 5.1 P0：客户端把「当前文件的语言」告诉宿主

* 客户端 `store.js` 的 `#startLsp()`：`call('lsp.start', { root, force })` → 加上 `languageId`。
* 语言从哪来：客户端 `lsp-uri.js` 的 `languageIdForPath(activePath)` —— **已经存在**，`.java` → `'java'`。
* 宿主 `src/index.js` 的 `lsp.start` 分支**已经接受** `languageId` —— 不需要改宿主这一层。

宿主侧（`lsp.js` 的 `#startSession`）：

```js
const language = languageId ?? detectLanguage(scopeRoot)
```

**已有 `languageId` 优先**这一行是对的，问题只在于客户端从来不传。

### 5.2 P0：宿主侧语言要稳定，不要来回抖

宿主**一个根只有一个会话**（`entry.session`）。所以：

* 根的语言在会话建立时**定死**（第一次决定说了算），存到 `entry.languageId`。
* 用户在同一个根里切到另一种语言的文件时，**不能**原地换服务器（会来回抖：一个 java 服务器起停 30 s，一个 ts 服务器又起停 30 s）。
* 规则建议：**同根内已存在的语言会话直接复用**；只有当用户在一个**从未起过**的语言文件上请求语义能力时，才起第二个会话。

### 5.3 P1：一个根一个会话 → 一个根多个会话

最终形态是 **一个 (root, language) 一个会话**，文档按语言路由。这需要动 `entry.session`（单数）与 `entry.documents` 的归属，改动面比 P0 大得多。

**建议本轮只做 P0**，把 P1 记成待办：

* P0 解决「打开 `.java` 文件却拿到 TypeScript 服务器」这个**最常见的**场景（Java 为主业的仓库，用户通常先开 Java 文件）。
* P1 解决「同一个仓库里同时用两种语言」的边角场景。

### 5.4 `detectLanguage()` 的兜底也要改

即便有了客户端传的 `languageId`，`detectLanguage()` 仍然是「客户端没给语言」时的兜底，而它今天的顺序（typescript 优先）会稳定误判。

建议改成**按源文件数量投票**：统计根目录下的源文件扩展名（`.java` / `.py` / `.ts` / `.go` / …），取数量最多的那种语言；`sourceCountOf()`（`lsp.js` 里已有）现在只数 `.ts/.tsx/.js/.jsx/.mjs/.cjs`，把它扩成一张扩展名表即可。投票平手时再退回标记文件顺序。

> 注意：`sourceCountOf()` 是**有界扫描**（最多 400 个文件、深度 3），不要为了投票改成全量扫描。

---

## 6. JS-05 —— 内存估算与上限落地（P1）

### 6.1 估算

```js
memoryBaselineMB: 512,   →   memoryBaselineMB: 2048,
```

理由：jdtls 起步就是 `-Xms1G`，加上 Eclipse 框架与索引，典型占用 1.5–2.5 GB。低估 4 倍会让闸门放行一台它养不起的服务器。

（`memoryLimitMB: 2048` 保持不变，它既是上限也是基准，两者对齐最省事。）

### 6.2 让上限真的落到 JVM 上

TS 是靠 `initializationOptions.maxTsServerMemory` 落到 tsserver 的（`MEMORY_LIMIT_AWARE` 机制，见 `lsp-worker.js`）。java 没有这个通道 —— 但方案 A 下插件**直接构造 JVM 参数**，所以可以：

```
-Xmx<ceilingMBOf(language, scopeRoot, lsp)>m
```

`ceilingMBOf()` 已经按项目规模分档 + 全局上限算好了（PRD-v5.1 MEM-11），插件在 `#spawn()` 里能拿到 `session.memoryLimitMB`。**这也是选方案 A 的一个附带好处**。

**必须同时下调 `-Xms`**（见 §2.3 的警告），否则上限小于 1 GB 时 JVM 直接起不来。

### 6.3 交互

`memoryBaselineMB` 变大 ⇒ 闸门更早地判定「机器吃不下」⇒ 在 16 GB 机器上开一个 Java 工程会比开一个 YAML 工程更容易弹「内存紧张」的提示。**这是正确的**：jdtls 确实吃得多。但提示文案要指向真实原因（"the available memory is tight for the restart of the language server…" 这类已有文案即可复用）。

---

## 7. 设置项与 API 变更（契约级）

### 7.1 设置项

写在 `src/host/settings-defaults.js` 的 `DEFAULT_LSP_SETTINGS.servers` 的**注释**里（`servers` 是自由对象，**不需要** schema 迁移 —— `settings-store.js` 的 `migrateLspSettings()` 只保证 `servers` 是对象，不校验里面的键）：

| 键 | 类型 | 默认值 | 语义 |
|---|---|---|---|
| `lsp.servers.java.javaHome` | string | `''` | 启动 jdtls 用的 JDK。**目录**（含 `bin\java.exe`）或 **java 可执行文件路径**均可。空 = 自动发现 |
| `lsp.servers.java.jdtlsHome` | string | `''` | jdtls 安装根目录。空 = 取 `JDTLS_HOME` 环境变量，再从 `jdtls` 命令路径反推 |
| `lsp.servers.java.javaSearchRoots` | string[] | `[]` | **追加**的 JDK 扫描根目录（自定义安装位置的用户用）。**默认空** —— 常规机器靠 §3.2 的 #1–#5 就够 |
| `lsp.servers.java.javaArgs` | string[] | `[]` | 追加到 JVM 参数末尾的自定义参数（调试用，例如 `-Dxxx`） |

同时把 `settings-defaults.js` 里 `servers` 那段注释从
`Per-language overrides: { [languageId]: { enabled, command, args } }`
扩成把上面四个键也写进去。

> **`javaSearchRoots` 是兜底，不是常规路径。** 它的存在只是为了让「IDE 装在一个谁也猜不到的地方、又不肯填 `javaHome`」的用户有出路。**默认值必须是空数组** —— 一旦默认值里带上任何具体路径，这个插件就退化成「只在这台机器上能用」了。

### 7.2 API

`lsp.servers`（`src/index.js` 的 `'lsp.servers'` → `LspManager.servers()`）里 java 那一条**新增** 4 个字段，便于设置页与诊断面板展示：

| 字段 | 类型 | 含义 |
|---|---|---|
| `jdtlsHome` | string \| null | 解析到的 jdtls 安装根 |
| `javaHome` | string \| null | 最终选中的 JDK 目录 |
| `javaVersion` | number \| null | 选中的 JDK 主版本号 |
| `jdkCandidates` | Array<{ path, version, source }> | 发现到的全部候选（给用户看）。`source` 说明**它是从哪儿发现的**：`setting` / `JAVA_HOME` / `path` / `jdk-table` / `bundled-jbr` / `scan` |

`source` 这一列不是装饰：**用户报「Java 起不来」时，第一件事就是看它选了哪个、为什么选它**。

### 7.3 注册表条目

```js
java: {
  command: 'jdtls',
  args: [],
  launcher: 'java',              // 新增：见 §2.2
  languageIds: ['java'],
  memoryLimitMB: 2048,
  memoryBaselineMB: 2048,        // 改（原 512）
  requires: 'a JDK the installed jdtls accepts',   // 改（原 'JDK 21+'）
},
```

---

## 8. 验收

### 8.1 单元测试（`dsh-ide-workbench/tests/`）

| 用例 | 断言 |
|---|---|
| 注册表 | `LSP_REGISTRY.java.launcher === 'java'`；`requires` 不再是 `'JDK 21+'`；`memoryBaselineMB >= 2048` |
| `javaHome` 解析 | 目录形式 / 可执行文件形式 / 空值 / 不存在的路径 四种输入的判定 |
| 版本解析 | 读 `release` 的 `JAVA_VERSION="25.0.3"` → 25；`"1.8.0_392"` → 8；文件缺失 → 跳过该候选 |
| 候选排序 | 显式 `javaHome` > 最高版本；`JAVA_HOME`=17 与 PATH=17 而 IDE JBR=25 时选中 25 |
| **宏展开** | `jdk.table.xml` 里的 `$USER_HOME$` 被展开成 `os.homedir()`；`~/` 也展开；展开后路径不存在则跳过该候选 |
| **两种布局** | IDE 装在 `<root>\<产品> <版本>\`（平铺）与 `<root>\<厂商>\<产品> <版本>\`（多一层）两种布局下**都能**找到 JBR |
| argv 构造 | 含 `-Xmx<上限>m`；`-Xms` 与 `-Xmx` **不冲突**（`-Xms <= -Xmx`）；含 `-data <每根独立>`；含 `-Declipse.application=org.eclipse.jdt.ls.core.id1` |
| `-data` 隔离 | 两个同名根（`D:\a\app`、`D:\b\app`）→ 两个**不同**的 `-data` |
| 路由 | 客户端传 `languageId='java'` 时，宿主起 java 服务器；不传时退回 `detectLanguage()` |
| 回归红线 | 现有 `lsp-registry.test.mjs` 里断言 `LSP_REGISTRY.java.command === 'jdtls'` 的用例**继续通过**（`command` 不变） |
| 回归红线 | `lsp-registry.test.mjs` 里 `assert.equal(LSP_REGISTRY.java.requires, 'JDK 21+')` **需要改**（本方案改了 `requires`）—— 这一条要在同一个 PR 里一起改 |

**可移植性用例（必须加，红线级）**

`src/host/idea.js` 的 `resolveIdeExecutable()` 已经建立了本仓库的**可注入环境**范式：

```js
options = { platform, env, stat, access, readdir, home }
```

JDK 发现**必须沿用同一个范式**（可注入 `env` / `home` / 文件系统读取），这样才能在不依赖本机的前提下测：

| 断言 | 说明 |
|---|---|
| **源码无机器相关路径** | 在 `src/host/java-runtime.js` 与 `src/host/lsp.js` 里 grep 不到盘符绝对路径、`C:\Program Files` 下的具体路径、`IntelliJ IDEA 2026`、用户名等字面量。**厂商目录名**（`JetBrains`、`Program Files`）是 §3.2 #6 要求的、由环境变量派生的兜底扫描的一部分，允许出现；`src/host/idea.js` 的既有 `C:\Program Files` 默认值属旧代码，不在本附录范围内 |
| **注入 env 即可发现** | 构造一个假的 env（`ProgramFiles` 指向 `/opt/ide`、`APPDATA` 指向假目录、PATH 里有假的 `idea64.exe`）＋ 假文件系统，断言能选出 JBR |
| **不依赖 `ProgramFiles`** | 把注入 env 里的 `ProgramFiles` 删掉，断言仍然能通过 `jdk.table.xml` 或 PATH 找到 JDK |
| **默认设置项为空** | `DEFAULT_LSP_SETTINGS.servers` 不含任何具体路径（`javaSearchRoots` 默认 `[]`） |

### 8.2 实机验收（本机即可）

1. `lsp.servers` 里 java 报为**已安装**，且 `javaHome` 指向 `…\IntelliJ IDEA 2026.1.4\jbr`、`javaVersion === 25`，`jdkCandidates` 里能看到发现到的来源（`JAVA_HOME` / `path` / `jdk-table` / `bundled-jbr` / `scan` 中的若干类；候选按 JDK **路径去重**，所以本机 PATH 上的 `java` 与 `JAVA_HOME` 是同一条时只会出现一次）。
2. 对一个**纯 Maven 工程**（只有 `pom.xml`，没有 `package.json`）：索引能建起来，状态栏从「索引中…」变成「就绪」。
3. `textDocument/completion`、跳转定义、悬停三者都有答案。
4. 对一个**混合仓库**（同时有 `package.json` 和 `pom.xml`）：打开 `.java` 文件 → 起的是 java 服务器（状态栏与诊断面板能看出是 Java）。
5. 空闲退出 / 内存压力释放之后，**没有残留的 `java.exe` 进程**（`Get-Process java`）—— 这是选方案 A 的核心理由，**必须验**。
6. `settings.lsp.servers.java.javaHome` 手动指向 Java 21 → 启动失败，错误信息里列出了本机找到的 JDK 及其版本。
7. **把 IDE 从 PATH 里摘掉、并且 `ProgramFiles` 指向一个空目录**（模拟一台「标准布局但 IDE 不在 PATH」的机器）→ 仍应通过 `jdk.table.xml` 找到 JDK，或给出「找不到，请设置 `javaHome`」的明确提示，**而不是**静默选一个 17。

---

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| **把本机路径写进代码** | 最容易犯、后果最直接的一种错：换个机器（或换个盘符、或 IDE 升级换目录）就整个 Java 功能失效，而且**不报错**，只是「找不到 JDK」 | §3.1 铁律；§3.2 六路来源全部由环境派生；§8.1 的**红线级可移植性用例**（grep 源码路径常量 + 注入假 env） |
| **`ProgramFiles` 不可信** | 本机 IDE 装在 `D:\ProgramFiles\Jetbrains\`，而 `%ProgramFiles%` 指向 `C:\Program Files` —— 按标准路径扫**一个都找不到** | 主力来源是 IDEA 自己写的绝对路径（`jdk.table.xml`）与 IDE 启动器反推；扫描只作兜底，且要试两种布局 |
| **目录布局有两种** | 平铺 `<root>\<产品> <版本>\` 与多一层厂商 `<root>\<厂商>\<产品> <版本>\` | 两种都试；IDE 启动器优先走 PATH / 设置项（与真实路径无关） |
| **`jdk.table.xml` 有宏** | `homePath` 里可能是 `$USER_HOME$` 或 `~/` | 统一做宏展开；展开后路径不存在就跳过该候选 |
| **`jdk.table.xml` 没有 JBR** | IDE 自带运行时是隐式的，不在用户 JDK 表里 | JBR 单独走「IDE 启动器 → `<ideHome>\jbr`」这条路 |
| **`idea.js` 的扫描假设平铺布局** | `resolveIdeExecutable()` 的 Windows 分支只扫 `<ProgramFiles>\JetBrains\<产品>\bin\*.exe`，扫不到本机的 `IDEA\<产品>` 布局 | 本方案**复用**它的 PATH / 设置项分支，但目录扫描要自己补两种布局（或顺手修 `idea.js`，但那超出本方案范围） |
| **equinox 启动器参数写死** | 方案 A 把 Eclipse 的启动契约写进了插件 | 参数来自 jdtls 官方发行包，1.x 内稳定；且**实测可用**（§0.1）。启动失败时错误信息要带完整 argv |
| **不同发行包布局不同** | 官方 tarball（`bin/jdtls`）与 pip 包（`jdtls.exe`）布局不同 | `jdtlsHome` 找不到时**退回方案 B**（Python + 官方脚本），并允许 `jdtlsHome` 手动指定 |
| **JBR 不是标准 OpenJDK** | JetBrains Runtime 有自己的补丁 | 它是 OpenJDK 25.0.3 + JBR 补丁，实测 jdtls 跑得好好的；用户也可以在设置里换成标准 JDK |
| **「取最高版本」可能选到太新的** | 未来的 JDK 26/27 | Java 向后兼容，风险低；且用户可以用 `javaHome` 钉死版本 |
| **闸门变严** | `memoryBaselineMB` 512 → 2048，Java 工程更容易触发「内存紧张」 | 这是修正而非退化：真实占用本来就是 1.5–2.5 GB。文案复用已有的 `resources.availableBytes` 口径 |
| **一个根多个会话（P1）改动面大** | `entry.session` 是单数 | 本轮只做 P0（客户端传语言 + 根内语言稳定），P1 单独立项 |

---

## 附录 A —— 不改代码的临时方案（今天就能用）

宿主已经支持用设置覆盖 `command` / `args`（`lsp.js` 的 `#startSession` 里 `override.command` / `override.args`），而 `probePath('python')` 在本机能命中 `D:\ProgramFiles\MiniConda\python.exe`。所以**改一行设置**就能先把 Java 用起来：

编辑 `C:\Users\X-L-S\.dsh\ide-workbench\settings.json`，把 `lsp.servers.java` 改成：

```json
"java": {
  "enabled": true,
  "command": "python",
  "args": [
    "D:\\ProgramFiles\\Jetbrains\\IDEA\\jdtls-1.63.0\\bin\\jdtls",
    "--java-executable",
    "D:\\ProgramFiles\\Jetbrains\\IDEA\\IntelliJ IDEA 2026.1.4\\jbr\\bin\\java.exe",
    "-data",
    "C:\\Users\\X-L-S\\.dsh\\ide-workbench\\lsp-workspace\\java"
  ]
}
```

实测等价于 §0.1 的 B 方案（`python …\bin\jdtls --java-executable <JBR25>`）—— **initialize 应答正常、26 项能力、Maven 工程导入并索引、completion 50 项**。

**这个临时方案的已知短板**（正是 JS-01/JS-03 要根治的）：

1. JVM 是**孙进程** —— 插件停不掉它（§2.1）。
2. `-data` 是**固定的一个目录** —— 所有 Java 工程共用一个工作区，索引互相污染。
3. 路径全部写死，换机器/换版本要重改。
4. 设置页会把 java 报成「命令 = python」，与真正的命令不符。

**建议**：把它当「验证 JS-01/JS-02 的方案是否成立」的探针 —— 如果这个临时配置在你的工程里能出补全和跳转，就说明剩下的确实只是插件侧的三件事（启动方式、JDK 发现、`-data` 隔离）。

---

## 附录 B —— 复现方法

本文所有结论都来自实机复现，脚本如下（Node 22，`child_process.spawn`，无 shell）。

**① 复现 ENOENT（§1.2 的 A 行）**

```js
import { spawn } from 'node:child_process'
const BIN = 'D:/ProgramFiles/Jetbrains/IDEA/jdtls-1.63.0/bin'
spawn(`${BIN}/jdtls`, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  .on('error', e => console.log(e.code, e.message))
// → ENOENT spawn D:/ProgramFiles/Jetbrains/IDEA/jdtls-1.63.0/bin/jdtls ENOENT
```

**② 复现 JDK 版本（§1.3）**

```js
const LAUNCHER = 'D:/ProgramFiles/Jetbrains/IDEA/jdtls-1.63.0/plugins/org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar'
const CONFIG = 'D:/ProgramFiles/Jetbrains/IDEA/jdtls-1.63.0/config_win'
for (const java of [
  'D:/ProgramFiles/Jetbrains/IDEA/JDK/bin/java.exe',                    // 17
  'D:/ProgramFiles/Jetbrains/IDEA/jdk-21.0.12.1/bin/java.exe',         // 21
  'D:/ProgramFiles/Jetbrains/IDEA/IntelliJ IDEA 2026.1.4/jbr/bin/java.exe', // 25 ✅
]) {
  // spawn(java, [...固定参数, '-jar', LAUNCHER, '-data', <tmp>])
}
```

**③ 复现「必须先发 initialize」（给实现者的提醒）**

jdtls 在收到 `initialize` **之前完全不往 stdout 写任何东西**。写探针时如果忘了先发握手，会看到「零输出」并误判成启动失败 —— 本次排查中就踩过一次。

帧格式：`Content-Length: <字节数>\r\n\r\n<JSON>`，**多帧直接首尾相接、没有分隔符**，解析时要循环切帧，不能只匹配第一帧。

**④ 复现「可移植的 JDK 发现」（§3.2 的实现参考）**

按 §3.2 的六路来源跑一遍，打印每个候选的**来源**和版本。本机实测输出：

```
v25  bundled JBR (IDEA)      D:\ProgramFiles\Jetbrains\IDEA\IntelliJ IDEA 2026.1.4\jbr
v25  bundled JBR (WebStorm)  D:\ProgramFiles\Jetbrains\Webstorm\WebStorm 2026.1.4\jbr
v25  bundled JBR (PyCharm)   D:\ProgramFiles\Jetbrains\Pycharm\PyCharm 2026.1.4\jbr
v21  jdk.table.xml           C:/Users/X-L-S/.jdks/corretto-21.0.3
v17  JAVA_HOME               D:\ProgramFiles\Jetbrains\IDEA\JDK
v17  PATH                    D:\ProgramFiles\Jetbrains\IDEA\JDK
v17  jdk.table.xml           D:/ProgramFiles/Jetbrains/IDEA/JDK
→ 选中：25
```

三个关键点（实现时别漏）：

1. **`jdk.table.xml` 的 `homePath` 要展开宏** —— 本机有一条是 `$USER_HOME$/.jdks/corretto-21.0.3`，不展开就找不到。
2. **JBR 不在 `jdk.table.xml` 里** —— 它是 IDE 的隐式运行时，只能从 IDE 启动器反推 `<ideHome>\jbr`。
3. **兜底扫描在本机命中 0 个** —— `%ProgramFiles%\JetBrains` 指向 `C:\Program Files\JetBrains`，而 IDE 在 `D:\ProgramFiles\Jetbrains\`。**这证明「扫标准目录」不可靠**，主力必须是前 5 路。

> 实现的形状建议照抄 `src/host/idea.js` 的 `resolveIdeExecutable()`：**可注入** `env` / `home` / `stat` / `access` / `readdir`，
> 这样 §8.1 的可移植性用例才能在**不依赖本机**的前提下跑（注入一个假 env + 假文件系统）。

---

## 附录 C —— 与既有文档的关系

* 本附录**不改动** `PRD-v5.1.md` 的 WS / MEM / CONC 条目。
* 本附录**不占用** `PRD-v5-缺陷跟踪.md` 的 D 编号（那一份止于 D18）。JS-01…JS-05 是独立编号。
* JS-05 与 PRD-v5.1 MEM-11（「让上限本身可信」）**方向一致**：MEM-11 说的是上限要可信，JS-05 是「java 这个语言的上限此前根本没落到 JVM 上」的具体案例。
* JS-04 与 PRD-v5.1 §4.2 CONC-01（「前置判定：这些『仓库』是不是独立语言项目」）**相关但不同**：CONC-01 判的是「一个根是不是一个项目」，JS-04 判的是「一个根该用哪个语言的服务器」。两者都建立在 `detectLanguage()` 的标记文件启发式上，**建议一起改**，或至少不要互相打架。
* **JS-02 与 `src/host/idea.js` 有交集**：JDK 发现要复用 `resolveIdeExecutable()`，但它的 Windows 目录扫描只认平铺布局（见 §3.2 #5 的说明框）。若顺手把 `idea.js` 的扫描补成两种布局，那是**另一个改动**，请单独评估影响面。
* 实施完成后，建议在 `PRD-v5-缺陷跟踪.md` 补一条指向本附录的索引。
