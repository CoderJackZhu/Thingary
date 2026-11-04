# 物谱文档

第一次使用先看[快速上手](QUICKSTART.md)，需要具体操作时查[使用指南](USER_GUIDE.md)。也可以在官网阅读[快速上手](https://thingary.jackzhu.top/quickstart/)和[按主题整理的帮助](https://thingary.jackzhu.top/guide/)。

## 使用软件

| 你要找的内容 | 入口 |
|---|---|
| 十分钟上手 | [快速上手](QUICKSTART.md) |
| 下载、安装、首次打开 | [安装步骤](USER_GUIDE.md#download) · [Windows 安装与排错](USER_GUIDE.md#windows-install) · [安卓安装](USER_GUIDE.md#android-install) · [GitHub Releases](https://github.com/CoderJackZhu/Thingary/releases) |
| 物品、首次账户盘点与规划 | [第一件物品](USER_GUIDE.md#first-record) · [第一次盘点](USER_GUIDE.md#first-snapshot) · [规划入门](USER_GUIDE.md#planning) |
| 记录收入、支出与资金流动 | [收支记录与财务复盘](USER_GUIDE.md#finance-review) |
| 目标、测算详情、试算与当前报告 | [规划入门](USER_GUIDE.md#planning) |
| 临时现金与工作变化条件 | [资金续航](USER_GUIDE.md#runway) · [职业试算](USER_GUIDE.md#career-trial) |
| 安卓与 iPhone、手机与电脑间搬资料 | [手机版操作](USER_GUIDE.md#phone) · [iPhone 获取方式](USER_GUIDE.md#iphone) · [备份搬运](USER_GUIDE.md#phone-transfer) |
| 可选 WebDAV 同步 | [配置、首次同步、冲突与口令](USER_GUIDE.md#sync) |
| 备份、恢复、Excel 与换机 | [资料保护](USER_GUIDE.md#backup) · [更新与换机](USER_GUIDE.md#update) |
| 疑问、支持范围与数值口径 | [常见问题](USER_GUIDE.md#faq) · [当前限制](USER_GUIDE.md#limits) · [业务规则](PRODUCT_RULES.md) |
| 关于、帮助与资料隐私 | [关于与帮助](USER_GUIDE.md#help) · [隐私与资料安全](USER_GUIDE.md#privacy) · [问题反馈](https://github.com/CoderJackZhu/Thingary/issues) |

## 贡献与维护

| 文档 | 职责 |
|---|---|
| [贡献指南](../CONTRIBUTING.md) | 范围、issue／PR、代码与提交约定 |
| [开发与测试](DEVELOPMENT.md) | 环境、预览、检查入口与当前验证边界；[同步测试](DEVELOPMENT.md#sync-tests)、[Android 构建与模拟器](DEVELOPMENT.md#android) |
| [架构说明](ARCHITECTURE.md) | 分层、存储、来源、请求与恢复约束；[WebDAV 同步](ARCHITECTURE.md#sync) |
| [文档维护](MAINTAINING.md) | 唯一权威入口与变更同步职责 |
| [发布流程](RELEASING.md#release-lifecycle) | 版本迭代、冻结、验收、文档截图、平台放行与发布回查；含打包步骤与 [Microsoft Store MSIX](RELEASING.md#microsoft-store)（[Microsoft Store 上架文案](releases/microsoft-store-listing.md)、[商店提交清单](releases/store-submission-checklist.md)）；iOS 上架准备见[iOS 小节](RELEASING.md#ios)、[App Store 文案草稿](releases/app-store-listing.md)与[审核风险评估](releases/app-store-review-notes.md) |
| [Windows 验收清单](WINDOWS_ACCEPTANCE.md) | 隔离安装、资料往返、通知、交互与候选包验收边界；含 [MSIX 真机清单](WINDOWS_ACCEPTANCE.md#msix-microsoft-store) |
| [Windows 代码签名政策](CODE_SIGNING.md) | 申请状态、签名范围、审批人、隐私与检查表 |
| [Windows 签名接入](SIGNING.md) | SignPath 状态、签名顺序、验签配置与回退方案 |
| [截图清单](images/README.md) | 虚构截图来源、尺寸、基线与复现 |
| [安全政策](../SECURITY.md) · [品牌使用](brand/README.md) | 漏洞与名称图标边界 |
| [来源告知](../SOURCE_NOTICES.md) · [规划核心说明](../crates/planning-engine/README.md) | 当前隔离实现范围、历史来源与核心接口 |

## 版本与兼容性

[版本记录](../CHANGELOG.md)说明每个版本的变化；[安装指南](USER_GUIDE.md#download)说明设备要求，[当前限制](USER_GUIDE.md#limits)列出影响使用的功能与兼容性限制。升级和换机前请先[做完整备份](USER_GUIDE.md#backup)。
