[简体中文](README.md) | [English](README.en.md)

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="物谱应用图标：谱线与记录点" width="112" height="112">
</p>

<h1 align="center">物谱 · Thingary</h1>

<p align="center"><strong>每月 10 分钟盘一次家底，算清还要上几年班。</strong></p>

<p align="center"><a href="https://github.com/CoderJackZhu/Thingary/releases/tag/v0.0.8"><strong>下载 0.0.8</strong></a> · <a href="https://thingary.jackzhu.top/">产品主页</a> · <a href="https://thingary.jackzhu.top/quickstart/">快速上手</a> · <a href="https://gitee.com/CoderJackZhu/thingary/releases">国内镜像</a> · <a href="https://github.com/CoderJackZhu/Thingary/issues/new?template=usage_feedback.yml">使用反馈</a></p>

![虚构样例的 21 秒界面预览：总览、账户盘点、目标、存钱目标、区间回顾与物品](docs/images/walkthrough.gif)

▶ [53 秒介绍视频](https://thingary.jackzhu.top/#film)：每月盘点、净资产变化、物品档案，以及每月多存一点、退休时间怎么跟着变。

钱分散在银行卡、余额宝、券商、基金平台、公积金和房贷里，很难看清全貌。物谱把账户、物品和计划放在一处：每月或每季对照各平台录一次余额和欠款，就能看到净资产变化，并回答三个问题：**每月要存多少、什么时候能不靠工资、歇一阵能撑多久。** 本地使用，无需账号；0.1.0 候选起可选用你自己的 WebDAV 手动同步加密快照，不需要每天记账。

## 能做什么

| | |
|---|---|
| **账户与盘点** | 记录资产、负债和房贷，按月或按季核对余额；完整盘点看净资产趋势，金额没变可逐行确认「与上次相同」 |
| **目标与测算** | 反算每月要存多少、估算财务独立时间；比较买一笔大件、休息一段时间或换工作的影响 |
| **复盘与计划** | 收支记录、区间回顾、存钱目标、周期费用和大额计划；金额未知保持未知，不当作零 |
| **物品档案（可选）** | 价格、照片、维修与保障，售出或退役后仍保留历史；查看日均持有成本 |
| **WebDAV 同步（0.1.0 候选，桌面版 Beta）** | 默认关闭；在设置 › 数据管理中手动上传或拉取加密整库快照到你自己管理的 WebDAV。不自动合并，不提供账号或托管服务。当前公开的 0.0.8 没有此入口 |
| **资料保护** | 完整备份、自动备份、最近删除；备份可用你自己保管的恢复密钥加密 |

它适合低频记录，不提供日常流水记账、行情交易或自动付款。

## 下载与安装

安装包只从本仓库的 [Releases](https://github.com/CoderJackZhu/Thingary/releases/tag/v0.0.8) 或 [Gitee 镜像](https://gitee.com/CoderJackZhu/thingary/releases/tag/v0.0.8) 下载。Release 附件里提供 `SHA256SUMS.txt`，用于核对文件完整性；它不是发布者签名，也不能证明文件来源。

### macOS

下载 [`Thingary-0.0.8-universal.dmg`](https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.8/Thingary-0.0.8-universal.dmg)（Apple Silicon 与 Intel 共用，最低 macOS 14）。

1. 打开 DMG，把「物谱」拖进「应用程序」，再从「应用程序」打开。
2. 安装包使用本地临时签名，**没有 Developer ID 签名，也没有 Apple 公证**。首次打开若被系统拦住，在 Finder 里右键（或按住 Control 点按）「物谱」→「打开」，再确认一次；也可以到「系统设置 › 隐私与安全性」点「仍要打开」。只对从本仓库 Release 下载的文件这样操作，不要关闭系统的整体安全保护。Apple 的说明见[打开来自身份不明开发者的 App](https://support.apple.com/zh-cn/102445)。
3. 核对校验和：在「终端」运行 `shasum -a 256 ~/Downloads/Thingary-0.0.8-universal.dmg`，把输出与 Release 里的 [`SHA256SUMS.txt`](https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.8/SHA256SUMS.txt) 对照。

已在 Apple Silicon、macOS 27 实测；macOS 14 和 Intel 只做了构建与架构检查，尚未实机验证。

### Windows

下载 [`Thingary_0.0.8_x64-setup.exe`](https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.8/Thingary_0.0.8_x64-setup.exe)。**Windows 11 x64 已实测；Windows 10 1809+ 是目标范围，但尚未实机验证。** 当前只提供 x64 安装包；ARM64 设备（如 Snapdragon X）由系统模拟运行 x64 应用，不等同于原生 ARM 版。

1. 运行安装包；默认只安装给当前用户，通常不需要管理员权限。缺少 WebView2 时安装器会联网下载并安装运行时，首次安装需要联网。
2. 安装包**未签名**，SmartScreen 可能提示「Windows 已保护你的电脑」：点「更多信息」→「仍要运行」。Windows 11 开启「智能应用控制」时可能没有放行按钮，处理办法见 [Windows 安装排查](https://thingary.jackzhu.top/guide/#windows-install)。不要为此关闭整机的系统保护。
3. 核对校验和：在 PowerShell 运行 `Get-FileHash .\Thingary_0.0.8_x64-setup.exe -Algorithm SHA256`，把结果与 Release 里的 [`SHA256SUMS.txt`](https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.8/SHA256SUMS.txt) 对照。
4. 安装或启动失败时，先看 [Windows 安装排查](https://thingary.jackzhu.top/guide/#windows-install)，并保留版本、Windows 版本、WebView2 版本和完整错误文字。

### Android（开发中，暂无安装包）

Android 版仍在开发，本仓库的 Release 里暂时没有 APK，请不要从第三方转存安装。发布后会提供 `Thingary-<版本>-android.apk`，校验值列在 Release 的 `SHA256SUMS.txt` 里：

1. 只从本仓库的 Release 下载 APK。
2. 按系统提示，允许浏览器或文件管理器「安装未知应用」，装好后可以收回这项权限。
3. 用 `sha256sum Thingary-<版本>-android.apk`（或文件管理器显示的哈希）与 `SHA256SUMS.txt` 对照，一致再安装。

### iOS（自行构建，无公开安装包）

iPhone 版目前没有上架 App Store，也不提供公开安装包。有 Xcode 的开发者可以自行构建并安装到自己的 iPhone，所需工具和步骤见[开发说明的 iOS 小节](docs/DEVELOPMENT.md#ios-开发)。

免费 Apple ID 的签名 **7 天后过期**，过期后需要重新构建安装；覆盖安装会保留资料，删除 App 会连同资料一起删除。手机与电脑的资料库各自独立，只能通过完整备份文件搬运。

## 三步开始

1. 首次打开直接进入**虚构样例**，可以先随便看看；点「开始记录我的资料」进入自己的空白资料。
2. 到「账户与盘点」对照各平台录一次余额和欠款；只想整理物品也可以从「全部物品」开始。不知道的金额留空，明确为零才填 0。
3. 到「目标」填目标时间和每月能存的钱，看右侧结论；「歇一阵能撑多久」在「试算」页。之后每月或每季回来盘一次即可。

录完第一批资料后，到「设置 › 数据管理」做一次完整备份，另外保存一份到原机之外。详见[备份与恢复](https://thingary.jackzhu.top/guide/#backup)。

## 已知限制

- **不联网取行情，也不做交易。** 没有实时价格、收益率、自动付款或 AI；投资收益和汇率需要自己填写。不提供日常流水记账。
- **WebDAV 同步从 0.1.0 候选起提供，是桌面版 Beta；当前公开的 0.0.8 没有同步入口。** 默认关闭；只有你在「设置 › 数据管理」配置自己的 WebDAV 并点同步时才联网，服务端只保存加密整库快照。同步不会自动合并；冲突时由你选择保留本机或使用云端。不提供账号体系、托管服务或多人协作。手机界面目前没有同步入口，手机与电脑之间仍用完整备份搬运。详见 [WebDAV 同步](https://thingary.jackzhu.top/guide/#sync)。
- **安装包未签名、未公证。** 项目目前不购买 Apple Developer 账号和 Windows 代码签名证书；发布包只做本地临时签名和校验和。以后若使用量足够，再考虑签名与公证。自行构建的方法见[开发说明](docs/DEVELOPMENT.md)。
- **界面目前只有简体中文。** 支持范围：macOS 14+（Apple Silicon 已实测，Intel 仅构建检查）、Windows 11 x64（已实测；Windows 10 1809+ 为目标范围但未实机验证；仅提供 x64 安装包，ARM64 走系统模拟；未签名）；Android 开发中，iOS 需自行构建；没有 Linux 客户端。完整清单见[已知限制](https://thingary.jackzhu.top/quickstart/#limits)。

## 资料与隐私

资料默认只保存在本机，没有账号，也不需要登录。除你主动配置的 WebDAV 同步和主动检查更新外，应用不联网。WebDAV 同步只连接你自己的服务器，上传前加密；服务端仍能看到文件大小、时间和常规网络信息，但看不到明文资料。WebDAV 地址、用户名和应用密码保存在本机同步设置文件里（未加密，权限仅当前用户），不进入资料库、备份或导出；应用密码保存后不再显示，请使用应用专用密码。检查更新只会读取 Gitee 与 GitHub 的公开版本列表；不发送资料、设备或使用信息（与普通网站访问一样，会带常规网络信息与应用版本 User-Agent）。iOS 版不检查更新。

主资料库和图片**未加密**；备份加密是可选项，恢复密钥由你保管，丢失无法找回。自动备份和主资料在同一块磁盘上，请另外保留一份异地备份。详见[隐私与资料安全](https://thingary.jackzhu.top/guide/#privacy)。

## 反馈

- [缺陷报告](https://github.com/CoderJackZhu/Thingary/issues/new?template=bug_report.yml)：发生了什么、怎么复现、版本与系统。
- [Windows 安装问题](https://github.com/CoderJackZhu/Thingary/issues/new?template=windows_install.yml)：安装、SmartScreen、WebView2、启动或卸载失败。
- [功能建议](https://github.com/CoderJackZhu/Thingary/issues/new?template=feature_request.yml)：先说想解决的问题，再说方案。
- [使用反馈](https://github.com/CoderJackZhu/Thingary/issues/new?template=usage_feedback.yml)：问三件事——你以前用什么？第二次盘点你回来了吗，为什么没回来？什么会让你推荐给别人？

请只用虚构数据复现，遮住真实金额和账户号，不要上传数据库或备份文件。安全问题请按[安全政策](SECURITY.md)私下报告。

## 文档与构建

[快速上手](https://thingary.jackzhu.top/quickstart/) · [完整使用指南](https://thingary.jackzhu.top/guide/) · [业务规则](docs/PRODUCT_RULES.md) · [版本记录](CHANGELOG.md) · [文档索引](docs/INDEX.md)。

参与开发见[贡献指南](CONTRIBUTING.md)、[开发与测试](docs/DEVELOPMENT.md)和[发布流程](docs/RELEASING.md)。在 Mac 上自行构建（需要 Node.js 22.18+、Rust 与 Xcode 命令行工具）：

```sh
rustup target add x86_64-apple-darwin wasm32-unknown-unknown
npm ci
npm run release
sh scripts/make-dmg.sh
```

Windows 在 MSVC 环境运行 `npm run release:win`。两者都会得到未签名的测试包；公开版本以 Release 为准。

## 许可

规划计算由独立的 Rust 核心实现，来源与许可说明见[来源告知](SOURCE_NOTICES.md)，接口与构建见[核心说明](crates/planning-engine/README.md)。

代码按 [AGPL-3.0-or-later](LICENSE) 授权（0.0.4 及更早版本发布时标注为 GPL-3.0-or-later），第三方依赖许可见 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES.md)。名称「物谱」「Thingary」与应用图标不在 AGPL 授权范围内；修改版再发布请采用自己的名称与图标，详见[品牌使用说明](docs/brand/README.md)。
