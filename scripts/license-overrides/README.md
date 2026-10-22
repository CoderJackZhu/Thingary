# 安装包许可证补全文本

锁定依赖有些发布归档仅带许可证标识，没有全文。本目录保存从其 `.cargo_vcs_info.json` 所指的确切上游提交取得的原文；`manifest.json` 按包名与版本登记来源和文件 SHA-256。`distribution-notices.mjs` 离线读取归档与这些补充文件，缺失文本或校验不符即停止打包。

`objc2` 系列保留上游声明，并补 SPDX 的 MIT 参考全文；`selectors` 的归档内源文件声明 MPL-2.0，补 Mozilla 官方全文。参考全文的版权占位符不是对项目作者的代填声明，作者元数据与上游声明分别保留。第三方文本遵循原有许可。

升级依赖时重新核对该版本归档，按确切上游提交更新缺失文本、来源和散列；不直接复用旧版本的许可判断。Rust 清单保守包含构建依赖，系统自带框架不在安装包中分发。许可证文本收集不替代对上游许可条件的核对。

Windows 的 `webview2-com`、`webview2-com-macros` 与 `webview2-com-sys` 发布归档缺少 Rust 绑定的 MIT 全文，补充文件按各自 `.cargo_vcs_info.json` 的上游提交固定；锁定图中同时含 `0.38.2` 与 `0.39.1` 两个版本。`webview2-com-sys` 还包含微软 WebView2 SDK loader：`0.38.2` 已比对其 x64 文件与官方 `Microsoft.Web.WebView2 1.0.3650.58` NuGet 归档一致，`0.39.1` 已比对与 `1.0.3800.47` 归档一致，SDK 的 `LICENSE.txt` 与 `NOTICE.txt` 独立作为 SDK 条目分发，不使用 Rust 绑定的 MIT 代替。来源与核对边界见 [直接内置内容告知](../../SOURCE_NOTICES.md#windows-webview2-loader)。SDK 记录另存原始归档 SHA-256，打包只读已固定的文本，不下载归档。

`node scripts/third-party-licenses.mjs` 生成 macOS Apple Silicon／Intel 与 Windows x64 MSVC 的可达依赖并集。`node scripts/distribution-notices.mjs <输出目录> --target x86_64-pc-windows-msvc` 收集 Windows 全文；省略目标时保留 `aarch64-apple-darwin` 默认值。Cargo 缓存和 npm 生产依赖需事先准备；运行收集器不会联网。
