# 代码签名政策（待定）

**状态：申请中，尚未批准。** 物谱当前所有 Windows 发布包（NSIS 安装包、MSIX 候选包）均**未经代码签名**，安装时可能触发 Windows SmartScreen 提示。SignPath 基金会尚未批准本项目，下列内容在批准并发布最终政策前不生效，也不表示任何发布包已由该基金会签名。

最终的签名政策、角色分工与归属声明将在**首次生产签名之前**发布在本页。

## Code signing policy (pending)

**Status: application pending, not approved.** Current Windows releases of Thingary (NSIS installer, MSIX candidates) are **not code-signed**. The SignPath Foundation has not approved this project, and nothing here implies that any release is signed by the Foundation. The final policy, role assignments and attribution will be published on this page before any production signing.

## 拟签名范围

- 仅 Windows x64 应用与 NSIS 安装包，由本仓库公开的 [GitHub Actions 工作流](https://github.com/CoderJackZhu/Thingary/actions/workflows/windows-package.yml)从公开源码构建。
- 不签名任何 iOS 或其他专有产物。
- 项目整体按 [AGPL-3.0-or-later](../LICENSE) 授权，不做商业双许可；历史来源见 [SOURCE_NOTICES](../SOURCE_NOTICES.md)。

## 平台组件

安装包在缺少 WebView2 时由安装器联网下载微软官方 bootstrapper 并安装运行时（`downloadBootstrapper` 模式，见[发布流程](RELEASING.md)）；运行时与 bootstrapper 都**不随安装包分发**。应用链接的微软 WebView2 SDK loader 保留其独立许可，见 SOURCE_NOTICES。

核对记录：2026-11-04 对 0.1.0 的 NSIS 安装包（CI run 225，提交 `8b06807`）用 7-Zip 列出内容，仅含应用主程序 `thingary.exe`、`许可/` 下的许可与来源文件，以及 NSIS 安装器自身的插件（含下载插件 `NSISdl.dll`）；没有 `MicrosoftEdgeWebview2Setup.exe` 或其他 WebView2 运行时文件。这是对该次构建的一次人工核对，不是构建脚本的自动断言；以后更改打包方式需重新核对。

## 隐私

应用联网行为（如检查更新、可选同步）见[使用指南](USER_GUIDE.md)与官网[隐私页](https://thingary.jackzhu.top/privacy/)。
