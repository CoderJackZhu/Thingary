# 物谱文档

使用软件请从[使用指南](USER_GUIDE.md#download)开始。主分支文档描述当前源码；公开安装包的功能与验收范围以对应[版本说明](../CHANGELOG.md)为准，不由设计批准、源码接入或本机安装推定。

## 使用软件

| 你要找的内容 | 入口 |
|---|---|
| 下载、安装、首次打开 | [安装步骤](USER_GUIDE.md#download) · [GitHub Releases](https://github.com/CoderJackZhu/Thingary/releases) |
| 物品档案与首次账户盘点 | [第一件物品](USER_GUIDE.md#first-record) · [第一次盘点](USER_GUIDE.md#first-snapshot) |
| 记录收入、支出与资金流动 | [收支记录与财务复盘](USER_GUIDE.md#finance-review) |
| 目标、计算详情与当前报告 | [规划入门](USER_GUIDE.md#planning) |
| 临时现金与工作变化条件 | [资金续航](USER_GUIDE.md#runway) · [职业试算](USER_GUIDE.md#career-trial) |
| 备份、恢复、Excel 与换机 | [资料保护](USER_GUIDE.md#backup) · [更新与换机](USER_GUIDE.md#update) |
| 疑问、支持范围与数值口径 | [常见问题](USER_GUIDE.md#faq) · [当前限制](USER_GUIDE.md#limits) · [业务规则](PRODUCT_RULES.md) |

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

## 已批准设计与当前阶段

当前源码的财富入口为账户与盘点、收支记录、财务复盘；规划保留目标。四问保存、明确净投入、资金／费用核对、实际发生接续、收入分类、投资区间核对、假设确认与资金流动已接入。当前报告是固定快照的只读预览，默认隐私、可复制摘要；不含基准／比较或原生 PDF。当前验证只维护在[开发说明](DEVELOPMENT.md#finance-workspace-validation)与[报告验证](DEVELOPMENT.md#current-report-validation)。

收入覆盖声明、历史总额参考、普通金额目标、命名方案、冻结基准及完整决策报告仍待实施。以下设计含分阶段规格或历史背景，不能把文件存在视为全部功能可用；政策退出与财务工作区的较新决定优先于旧政策页、旧导航和职业阶段条款。

| 唯一设计入口 | 范围与状态 |
|---|---|
| [财富记录、财务复盘与目标规划](FINANCE_WORKSPACE_DESIGN.md) | 当前导航、能力与设置接入；核心验证已完成，完整验收边界见开发说明 |
| [长期维护优先与政策退出](PRODUCT_BOUNDARIES_DESIGN.md) | 政策模型退出已实施；保留事实、通用未来收入、市场分析与损益金额，不做政策资格或收益率 |
| [简化规划接口](PLANNING_SIMPLIFICATION_CONTRACT.md) · [假设／流动接入契约](PLANNING_FOLLOWUP_PARALLEL_CONTRACT.md) | 当前领域、保存、假设与资金流动边界 |
| [规划生命周期](PLANNING_LIFECYCLE_DESIGN.md) | 通用基础与发生接续已接入；普通目标、方案与基准分阶段后续 |
| [资金、事件与方案](PLANNING_DATA_SCENARIOS_DESIGN.md) | 统一月账本、事实／假设分离、费用去重与后续持久对象契约 |
| [金融历史导入](FINANCIAL_HISTORY_IMPORT_DESIGN.md) | 账户／完整盘点／收入已接入 Excel；覆盖声明与总额参考尚未接入 |
| [复盘、基准与报告](PLANNING_REVIEW_REPORT_DESIGN.md) · [组件契约](PLANNING_COMPONENT_CONTRACTS.md) | 轻量复盘、纯解析器和当前报告预览已接入；冻结基准及完整报告仍后续 |
| [可选职业变化情景](CAREER_SCENARIO_DESIGN.md) | 当前临时试算；不保存职业路线、不预测政策待遇 |
| [综合总览](OVERVIEW_PLANNING_DESIGN.md) | 净资产事实与规划摘要并排，窄窗上下排列 |
| [低频整理与心愿决策](LOW_FREQUENCY_REVIEW_DESIGN.md) | 心愿决定、盘点、全局搜索及替换关系已接入 |
| [共用界面操作](VISUAL_SYSTEM_DESIGN.md) | 表单、菜单、图片与日期／月份组件；更广图表与目标细化分阶段实施 |
| [年度支出与订阅关联](EXPENSE_OVERVIEW_SUBSCRIPTION_LINKS_DESIGN.md) · [虚拟标签与计费](VIRTUAL_ASSET_BILLING_DESIGN.md) | 当前计费、付款、关联删除恢复及历史迁移规格；通知实际送达未验证 |

原[规划模块设计](PLANNING_DESIGN.md)保留历史实现背景，不再授权旧养老金、医保、地区参数或职业阶段行为。纯解析器与报告组件的工程入口见[解析器说明](../src-tauri/src/financial_import_parser/README.md)和[报告说明](../src/planning-report/README.md)。
