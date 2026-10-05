# 物谱文档

第一次使用请从[使用指南](USER_GUIDE.md#download)开始；无需阅读开发文档或自行编译。

## 使用软件

| 你要找的内容 | 入口 |
|---|---|
| 下载、安装、首次打开 | [安装步骤](USER_GUIDE.md#download) |
| 记录物品与核对账户 | [第一件物品](USER_GUIDE.md#first-record) · [第一次盘点](USER_GUIDE.md#first-snapshot) |
| 备份、恢复与换机 | [完整备份](USER_GUIDE.md#backup) · [更新与换机](USER_GUIDE.md#update) |
| 操作疑问与支持范围 | [常见问题](USER_GUIDE.md#faq) · [当前限制](USER_GUIDE.md#limits) |
| 数字如何计算 | [业务规则](PRODUCT_RULES.md) |
| 下载与版本变化 | [GitHub Releases](https://github.com/CoderJackZhu/Thingary/releases) · [版本记录](../CHANGELOG.md) |

## 贡献与维护

| 文档 | 职责 |
|---|---|
| [贡献指南](../CONTRIBUTING.md) | 改动范围、issue／PR、代码约定 |
| [开发与测试](DEVELOPMENT.md) | 环境、预览、检查入口、界面验证 |
| [架构说明](ARCHITECTURE.md) | 分层、存储、文件、请求与恢复约束 |
| [文档维护](MAINTAINING.md) | 权威入口、代码与笔记分工、变更时怎样保持一致 |
| [发布流程](RELEASING.md) | 版本、安装包、许可、核验与公开交付 |
| [安全政策](../SECURITY.md) | 私密漏洞报告 |
| [品牌使用](brand/README.md) | 正式图标源文件与名称图标边界 |

本目录维护当前软件的使用与贡献说明。逐轮开发计划、调研和验收记录另行归档，不作为使用前置材料。

## 已批准的设计

- [低频整理、盘点与心愿决策](LOW_FREQUENCY_REVIEW_DESIGN.md)：心愿清单改为大额购买的考虑与决策记录，补齐盘点日期、备注、只读详情、搜索全部资料与待替换物品。盘点逐账户填齐数值后保存，取消“未变”“未知”和批量确认。**A／B／C 已实现并完成 Review 修复、自动检查与隔离核心原生验收；系统输入法组合、VoiceOver 与通知送达未验。** 现行规则、指南与架构已同步。
- [规划模块](PLANNING_DESIGN.md)：独立的可开关模块，用月度收入与盘点推出真实储蓄，估算养老金、退休／FIRE 时间及心愿中大额支出的影响。**设计草案，尚未实现，当前规则与指南不含此功能。**
- [虚拟资产标签与计费](VIRTUAL_ASSET_BILLING_DESIGN.md)：标签复用、订阅与储值的目标行为、兼容性和验收约束。已实现并完成独立复审修复，纳入 2026-10-05 重建的 0.0.1 Beta（原生完整交互验收尚未闭环）；有效规则见 [PRODUCT_RULES](PRODUCT_RULES.md)。
