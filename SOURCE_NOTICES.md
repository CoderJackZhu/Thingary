# 直接内置内容的来源告知

锁定依赖的许可另见 `THIRD_PARTY_LICENSES.md` 与随包 `THIRD_PARTY_NOTICES.txt`。本文件覆盖直接写入项目的已登记外部内容，以及包管理器许可标识未覆盖的随包二进制。

## Mulberry32

位置：`src/plan-risk.ts` 的 `mulberry32`。用于复现市场模拟的随机序列，不用于安全或密码学。

算法作者：Tommy Ettinger，2017。原始实现作者声明将相关权利按 CC0 贡献至公共领域，不提供保证：

- 原始 C 实现与声明：<https://gist.github.com/tommyettinger/46a874533244883189143505d203312c>
- CC0 1.0：<https://creativecommons.org/publicdomain/zero/1.0/>
- JavaScript 参考：bryc 的 PRNG 说明，文件开头声明 public domain：<https://github.com/bryc/code/blob/master/jshash/PRNGs.md>

本项目保留算法运算，增加种子转换与显式 32 位截断。以上是已核实的算法参考；本项目最初创建时实际取用哪个版本没有检索到记录，不能据此声称某份 JavaScript 改写来自原始 C 作者。其他来源各自的许可不能由此改变。

## 规划模块

早期参考来源：[Wealthfolio](https://github.com/wealthfolio/wealthfolio/tree/51cdbf92e2738c6e8c58fa9f04ae630125549043)，[上游许可 AGPL-3.0](https://github.com/wealthfolio/wealthfolio/blob/51cdbf92e2738c6e8c58fa9f04ae630125549043/LICENSE)。后续已重写已定位的复用内容，但重写不是洁净室实现；为与上游许可保持一致，本项目自 2026-10-13 起整体按 AGPL-3.0-or-later 授权。0.0.4 及更早版本发布时标注为 GPL-3.0-or-later，重新分发这些旧版本时同样按上游 AGPL-3.0 处理相关部分。

## Windows WebView2 loader

Windows x64 MSVC 构建通过锁定的 `webview2-com-sys 0.38.2` 链接 `WebView2LoaderStatic.lib`。Rust 包的 MIT 声明只覆盖上游 Rust 绑定；微软 SDK loader 保留其独立许可与第三方告知，不由物谱的 AGPL 或 Rust 绑定的 MIT 改写。

来源：该 crate 发布归档的 `.cargo_vcs_info.json` 指向 [上游提交 b74dc5e](https://github.com/wravery/webview2-rs/tree/b74dc5e2b394044bea5191052868ce7a106c202c)，该提交的 [SDK 获取脚本](https://github.com/wravery/webview2-rs/blob/b74dc5e2b394044bea5191052868ce7a106c202c/crates/update-bindings/src/main.rs) 固定 `Microsoft.Web.WebView2 1.0.3650.58`。已比对官方 NuGet 归档与 crate 的 x64 loader 文件，三份文件逐字节相同；静态库 SHA-256 为 `0659b741bde6348d4c4a6ec4ceb9af50e3d0048ed9cd3c8659bccbb61fde55ee`。

官方归档：[Microsoft.Web.WebView2 1.0.3650.58](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3650.58)。其中 `LICENSE.txt` 保留微软版权、BSD 三条款条件与免责声明，`NOTICE.txt` 保留 SDK 随附第三方告知。两份原文保存在 `scripts/license-overrides/microsoft--webview2/1.0.3650.58/`，原始来源、归档与文本 SHA-256 登记在 `manifest.json`；Windows 分发通知独立收集为 SDK 条目。SDK 清单保守附上整个 SDK 的告知，不把 SDK 的其他组件称为本应用实际链接组件。

本项仅登记 loader 来源与随包文本，不表示分发 WebView2 Runtime。运行时部署方式与验证范围以当前 Windows 构建配置及发布文档为准，Runtime 自身适用微软条款。升级 `webview2-com-sys` 或改变 loader／Runtime 打包方式时，应重新核对相应归档与条款。
