# Agent X 插件离线安装（{{NAME}} {{VERSION}}）

这个压缩包用于**完全断网**的内网机器：里面已经带好插件本身、运行时依赖
（`package/node_modules`，{{DEPENDENCIES}} 项）和安装脚本，安装过程不需要网络、
不需要 npm / pnpm、也不需要 DSH 的插件市场。

适用：`{{NAME}}@{{VERSION}}`，DSH ≥ 0.1.7（DSH Desktop 0.2.x 或 Web profile）。

## 包里有什么

```
{{NAME}}-{{VERSION}}-offline/
  package/            插件本体（与 npm 发布包一致）+ 运行时 node_modules
  install-offline.ps1 Windows 安装脚本
  install-offline.sh  macOS / Linux 安装脚本
  patch-profile.mjs   把插件登记进 profile 的 package.json（脚本内部调用）
  README-OFFLINE.md   本文件
```

## 安装（Windows）

```powershell
# 默认装进 DSH_HOME\profiles\web
.\install-offline.ps1 -Profile web

# Desktop 应用管理的 profile（桌面端请先退出 DSH）
.\install-offline.ps1 -Profile desktop

# DSH_HOME 不在默认位置时
.\install-offline.ps1 -Profile web -DshHome D:\dsh-home
```

## 安装（macOS / Linux）

```sh
./install-offline.sh --profile web
./install-offline.sh --profile web --dsh-home /opt/dsh-home
```

脚本做三件事，都不联网：

1. 把 `package/` 复制到 `<profile>/offline-plugins/{{NAME}}`；
2. 在 `<profile>/node_modules/` 里建立指向它的链接（Windows 用 junction）；
3. 在 profile 的 `package.json` 里登记依赖（`file:./offline-plugins/{{NAME}}`）并把
   {{NAME}} 加进 `dsh.profile.bundles` —— 这是 DSH 加载插件方式。

装完**重启该 profile**（Desktop 端退出并重新打开 DSH）。

## 之后需要注意

- **不要在断网状态下运行 `pnpm install`**：它会把 profile 的全部依赖重新解析一遍。安装脚本
  已经把依赖装进了插件目录，不需要包管理器。
- 想升级时，用新版本的离线包再跑一次脚本即可，会覆盖旧版本。
- 卸载：删掉 `<profile>/offline-plugins/{{NAME}}` 与 `<profile>/node_modules/{{NAME}}`，
  再从 profile 的 `package.json` 里去掉同名依赖和 `dsh.profile.bundles` 里的同名条目。
- 校验：同目录的 `SHA256SUMS.txt` 给出压缩包的 sha256。
