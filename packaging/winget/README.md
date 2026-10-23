# winget 清单

这里存放 `CoderJackZhu.Thingary` 的 winget 清单，供提交到 [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) 使用。

## 当前状态

- 已生成 `0.0.8` 清单，安装包 URL 与 SHA-256 对应 GitHub Release `v0.0.8`。
- **尚未提交到 winget-pkgs。** `0.0.8` 是未签名公开测试版；建议等下一个稳定候选（如 `0.1.0`）再提交，或明确接受测试版进入 winget。
- winget 不会消除 SmartScreen；安装包签名仍由 SignPath 或 Store 解决。

## 目录

```text
packaging/winget/manifests/
└── c/CoderJackZhu/Thingary/0.0.8/
    ├── CoderJackZhu.Thingary.yaml
    ├── CoderJackZhu.Thingary.installer.yaml
    ├── CoderJackZhu.Thingary.locale.zh-CN.yaml
    └── CoderJackZhu.Thingary.locale.en-US.yaml
```

winget-pkgs 的目录规则是 `manifests/<PackageIdentifier 首字母小写>/<Publisher>/<Package>/<Version>/`。提交时把整个 `0.0.8` 目录复制到 fork 的相同路径。

## 生成新版本

构建出 Windows NSIS 安装包后，在仓库根目录运行：

```sh
node scripts/generate-winget-manifest.mjs \
  --version 0.1.0 \
  --installer Thingary_0.1.0_x64-setup.exe \
  --release-date 2026-10-24
```

也可以只给 SHA-256（适合在另一台机器上生成清单）：

```sh
node scripts/generate-winget-manifest.mjs \
  --version 0.1.0 \
  --sha256 <64 位十六进制 SHA-256> \
  --release-date 2026-10-24
```

默认安装包名为 `Thingary_<版本>_x64-setup.exe`，默认下载地址为：

```text
https://github.com/CoderJackZhu/Thingary/releases/download/v<版本>/Thingary_<版本>_x64-setup.exe
```

可用 `--installer-name`、`--tag`、`--base-url`、`--output` 覆盖。生成器会校验版本、SHA-256、日期和 URL，并写出四个清单文件。

## 本地验证（Windows）

在 Windows 上安装 winget 后：

```powershell
winget validate --manifest .\packaging\winget\manifests\c\CoderJackZhu\Thingary\0.0.8
winget install --manifest .\packaging\winget\manifests\c\CoderJackZhu\Thingary\0.0.8
```

建议在干净虚拟机里验证安装、开始菜单入口、卸载保留资料和重装。`winget install` 仍可能遇到 SmartScreen 或 Smart App Control，未签名包不会被 winget 变成受信任包。

## 提交到 winget-pkgs

1. Fork `microsoft/winget-pkgs`。
2. 把 `packaging/winget/manifests/c/CoderJackZhu/Thingary/<版本>` 复制到 fork 的 `manifests/c/CoderJackZhu/Thingary/<版本>`。
3. 在 Windows 上运行 `winget validate --manifest <目录>`，修到通过。
4. 提交 PR，标题建议：`Add CoderJackZhu.Thingary version <版本>`。
5. 等待 wingetbot 校验；按评论修正 schema、URL、SHA 或安装器行为。
6. 合并后可用 `winget install CoderJackZhu.Thingary` 安装。

## 注意

- **不要为同一版本重复提交不同 SHA。** 重新打包后版本号必须递增；winget 以版本为键。
- **安装包 URL 必须长期可访问。** 不要用临时 artifact、Gitee 临时链接或会过期的网盘地址。
- **签名后重新生成清单。** 签名会改变安装包 SHA-256；版本和 URL 不变时也要更新 `InstallerSha256`。
- **界面只有简体中文。** en-US 清单只是便于英文用户理解，不会让应用变成英文。
- `InstallerType: nullsoft`、`Scope: user` 对应当前 Tauri NSIS `currentUser` 安装；如果安装方式改变，清单必须同步修改。
- 首次提交后包标识 `CoderJackZhu.Thingary` 即被占用；不要在其他清单里复用。
