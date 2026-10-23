# 物谱文档

使用软件请先看[网站快速上手](https://thingary.jackzhu.top/quickstart/)；需要细节时查[按主题整理的使用指南](https://thingary.jackzhu.top/guide/)。仓库保留[快速上手源文档](QUICKSTART.md)与[完整参考](USER_GUIDE.md#download)，兼容已发布版本的帮助链接。主分支文档描述当前源码；公开安装包的功能与验收范围以对应[版本说明](../CHANGELOG.md)为准，不由设计批准、源码接入或本机安装推定。

## 使用软件

| 你要找的内容 | 入口 |
|---|---|
| 十分钟上手 | [快速上手](QUICKSTART.md) |
| 下载、安装、首次打开 | [安装步骤](USER_GUIDE.md#download) · [Windows 安装与排错](USER_GUIDE.md#windows-install) · [GitHub Releases](https://github.com/CoderJackZhu/Thingary/releases) |
| 物品、首次账户盘点与规划 | [第一件物品](USER_GUIDE.md#first-record) · [第一次盘点](USER_GUIDE.md#first-snapshot) · [规划入门](USER_GUIDE.md#planning) |
| 记录收入、支出与资金流动 | [收支记录与财务复盘](USER_GUIDE.md#finance-review) |
| 目标、测算详情、试算与当前报告 | [规划入门](USER_GUIDE.md#planning) |
| 临时现金与工作变化条件 | [资金续航](USER_GUIDE.md#runway) · [职业试算](USER_GUIDE.md#career-trial) |
| iPhone 版、手机与电脑间搬资料 | [iPhone 版](USER_GUIDE.md#iphone) · [在 iPhone 与电脑之间搬资料](USER_GUIDE.md#phone-transfer) |
| 备份、恢复、Excel 与换机 | [资料保护](USER_GUIDE.md#backup) · [更新与换机](USER_GUIDE.md#update) |
| 疑问、支持范围与数值口径 | [常见问题](USER_GUIDE.md#faq) · [当前限制](USER_GUIDE.md#limits) · [业务规则](PRODUCT_RULES.md) |
| 关于、帮助与资料隐私 | [关于与帮助](USER_GUIDE.md#help) · [隐私与资料安全](USER_GUIDE.md#privacy) · [问题反馈](https://github.com/CoderJackZhu/Thingary/issues) |

## 贡献与维护

| 文档 | 职责 |
|---|---|
| [贡献指南](../CONTRIBUTING.md) | 范围、issue／PR、代码与提交约定 |
| [开发与测试](DEVELOPMENT.md) | 环境、预览、检查入口与当前验证边界 |
| [架构说明](ARCHITECTURE.md) | 分层、存储、来源、请求与恢复约束 |
| [文档维护](MAINTAINING.md) | 唯一权威入口与变更同步职责 |
| [发布流程](RELEASING.md#release-lifecycle) | 版本迭代、冻结、验收、文档截图、平台放行与发布回查；含打包步骤；iOS 上架准备见[iOS 小节](RELEASING.md#ios)与[App Store 文案草稿](releases/app-store-listing.md) |
| [Windows 验收清单](WINDOWS_ACCEPTANCE.md) | 隔离安装、资料往返、通知、交互与候选包验收边界 |
| [Windows 签名接入](SIGNING.md) | SignPath 状态、签名顺序、验签配置与回退方案 |
| [截图清单](images/README.md) | 虚构截图来源、尺寸、基线与复现 |
| [安全政策](../SECURITY.md) · [品牌使用](brand/README.md) | 漏洞与名称图标边界 |
| [来源告知](../SOURCE_NOTICES.md) · [规划核心说明](../crates/planning-engine/README.md) | 当前隔离实现范围、历史来源与核心接口 |

## 当前阶段

当前源码版本为 **0.1.0 候选**，尚未发布；公开下载仍是 0.0.8。0.1.0 的发布范围、验收和说明在冻结后按[发布流程](RELEASING.md#release-lifecycle)补齐，不能把候选版本号当作已发布；当前草稿见 [v0.1.0](releases/v0.1.0.md)。

0.0.8 在 0.0.7（账户类型、存钱目标、区间回顾、加密备份，schema 42）基础上新增外币账户、投资份额、账户分组、单账户快速更新、屏幕隐私与可选的启动时检查更新等，资料结构升至 schema 44，作为公开测试版发布；下载包所含功能以[版本说明](releases/v0.0.8.md)为准。未完整验证的项目见[已知限制](QUICKSTART.md#limits)，开发验证见开发说明。

当前源码的财富入口为账户与盘点、收支记录、财务复盘；物品状态收在列表工具栏；规划以目标为单入口，页内分为目标、测算详情与试算。首次使用可从物品档案或账户盘点开始。五步设置（净投入可跳过）、明确净投入、资金／费用核对、实际发生接续、收入分类、投资区间核对、假设确认与资金流动已接入。当前报告是固定快照的只读预览，默认隐私、可复制摘要；不含基准／比较或原生 PDF。当前验证只维护在[开发说明](DEVELOPMENT.md#finance-workspace-validation)、[报告验证](DEVELOPMENT.md#current-report-validation)与[规划核心接入验收](DEVELOPMENT.md#planning-engine-validation)。

0.0.8 同时提供 Mac 与 Windows 安装包（Windows 11 x64 已实测；Windows 10 1809+ 为目标范围但未实机验证；仅提供 x64，ARM64 走系统模拟；未签名）。原生验收未覆盖的项目不代表通过，检查和未验项见[Windows 开发验证](DEVELOPMENT.md#windows-validation)与[固定验收清单](WINDOWS_ACCEPTANCE.md)，安装见[使用指南](USER_GUIDE.md#windows-install)。

收入覆盖声明、历史总额参考、命名方案、冻结基准及完整决策报告尚未实施。现行行为以[业务规则](PRODUCT_RULES.md)、[架构说明](ARCHITECTURE.md)与[共用界面操作](VISUAL_SYSTEM_DESIGN.md)为准；分阶段设计与执行记录保存在维护者档案，不作为贡献或构建的前提。纯解析器与报告组件的工程入口见[解析器说明](../src-tauri/src/financial_import_parser/README.md)和[报告说明](../src/planning-report/README.md)。
