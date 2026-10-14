# 物谱文档

使用软件请从[使用指南](USER_GUIDE.md#download)开始。主分支文档描述当前源码；公开安装包的功能与验收范围以对应[版本说明](../CHANGELOG.md)为准，不由设计批准、源码接入或本机安装推定。

## 使用软件

| 你要找的内容 | 入口 |
|---|---|
| 下载、安装、首次打开 | [安装步骤](USER_GUIDE.md#download) · [GitHub Releases](https://github.com/CoderJackZhu/Thingary/releases) |
| 物品档案与首次账户盘点 | [第一件物品](USER_GUIDE.md#first-record) · [第一次盘点](USER_GUIDE.md#first-snapshot) |
| 记录收入、支出与资金流动 | [收支记录与财务复盘](USER_GUIDE.md#finance-review) |
| 目标、测算详情、试算与当前报告 | [规划入门](USER_GUIDE.md#planning) |
| 临时现金与工作变化条件 | [资金续航](USER_GUIDE.md#runway) · [职业试算](USER_GUIDE.md#career-trial) |
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
| [发布流程](RELEASING.md) | 版本、签名、安装包及公开交付核验 |
| [截图清单](images/README.md) | 虚构截图来源、尺寸、基线与复现 |
| [安全政策](../SECURITY.md) · [品牌使用](brand/README.md) | 漏洞与名称图标边界 |

## 当前阶段

当前源码的财富入口为账户与盘点、收支记录、财务复盘；物品状态收在列表工具栏；规划以目标为单入口，页内分为目标、测算详情与试算。首次使用可从物品档案或账户盘点开始。五步设置（净投入可跳过）、明确净投入、资金／费用核对、实际发生接续、收入分类、投资区间核对、假设确认与资金流动已接入。当前报告是固定快照的只读预览，默认隐私、可复制摘要；不含基准／比较或原生 PDF。当前验证只维护在[开发说明](DEVELOPMENT.md#finance-workspace-validation)、[报告验证](DEVELOPMENT.md#current-report-validation)与[规划核心接入验收](DEVELOPMENT.md#planning-engine-validation)。

收入覆盖声明、历史总额参考、普通金额目标、命名方案、冻结基准及完整决策报告尚未实施。现行行为以[业务规则](PRODUCT_RULES.md)、[架构说明](ARCHITECTURE.md)与[共用界面操作](VISUAL_SYSTEM_DESIGN.md)为准；分阶段设计与执行记录保存在维护者档案，不作为贡献或构建的前提。纯解析器与报告组件的工程入口见[解析器说明](../src-tauri/src/financial_import_parser/README.md)和[报告说明](../src/planning-report/README.md)。
