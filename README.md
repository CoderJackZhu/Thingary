# 物谱 · Thingary

**记录你的物品，回顾你的净资产。**

物谱是一个本地使用的 macOS 应用。为值得留档的物品建立档案，每隔一段时间核对账户余额，看看物品、花费和金融净资产如何随时间变化。无需注册账号，也无需编程或联网使用。

**[下载 0.0.1 公开测试版 · Apple Silicon Mac](https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.1/Thingary-0.0.1-arm64.dmg)** · [图文使用指南](docs/USER_GUIDE.md#download) · [版本说明](https://github.com/CoderJackZhu/Thingary/releases/tag/v0.0.1) · [反馈问题](https://github.com/CoderJackZhu/Thingary/issues)

![物谱总览：物品档案与账户盘点](docs/images/overview-light.png)

## 开始使用

1. 下载 `.dmg`，打开后将「物谱」拖入「应用程序」。
2. 从「应用程序」打开物谱，先浏览独立的虚构样例。
3. 点「开始记录我的资料」，[记录第一件物品](docs/USER_GUIDE.md#first-record)；需要时再[完成第一次账户盘点](docs/USER_GUIDE.md#first-snapshot)。
4. 录入自己的资料后，[做一次完整备份并异地保存](docs/USER_GUIDE.md#backup)。

当前 **0.0.1 公开测试版** 使用本地临时签名，未经过 Developer ID 签名和 Apple 公证。首次打开可能需要在「系统设置 › 隐私与安全性」选择「仍要打开」；请按[安装与故障排查指南](docs/USER_GUIDE.md#download)操作，无需编译或使用终端。下载页中的 Source code 是源码，不是安装包。

| 支持范围 | 当前情况 |
|---|---|
| 芯片 | 提供 Apple Silicon（M 系列）安装包；暂无 Intel 包 |
| 系统 | 已在 macOS 27 验证；打包最低目标为 macOS 14，其他版本尚未实测 |
| 语言与更新 | 界面为中文；目前需手动下载安装更新 |
| 其他平台 | 暂无 Windows、Linux、手机客户端或跨设备同步 |

本系列处于公开测试阶段，欢迎反馈安装、使用与兼容性问题。此前短暂发布的 2.6.1 与 0.1.0-beta.1 安装包已撤下，当前只提供最新 0.0.1 Beta；已使用者请先完整备份，再按[更新步骤](docs/USER_GUIDE.md#update)手动更换。

## 可以记录什么

| 你想做的事 | 物谱提供的功能 |
|---|---|
| 为贵重物品留档 | 名称、品牌型号、购入日期与金额、照片、备注、维护和保障记录 |
| 回顾持有与处置 | 使用中、退役、售出，日均／按次成本，以及售出保值率 |
| 规划想买的东西 | 心愿清单与攒钱进度，实现后转换为物品档案 |
| 定期核对家底 | 账户与负债快照、金融净资产趋势、两次盘点的账户变化 |
| 回顾重要花费 | 大额支出、退款、周期费用及软件／域名等虚拟资产档案 |
| 找回与带走资料 | 最近删除、完整备份恢复、自动备份、CSV 导入导出 |

物谱适合低频记录，例如每月盘点一次账户、补充近期的重要购入。它不提供日常流水记账、行情交易或自动付款。物品购入金额和金融净资产分别展示，不相加，也不重复扣减。辅助模块可在设置中关闭。

<details>
<summary>查看更多界面：深色外观、物品档案与账户盘点</summary>

| 物品档案 | 账户与盘点 |
|---|---|
| ![全部物品](docs/images/assets-light.png) | ![账户与盘点](docs/images/wealth-light.png) |
| ![深色总览](docs/images/overview-dark.png) | ![深色物品统计](docs/images/stats-dark.png) |

</details>

截图来自浏览器预览，全部使用虚构资料；应用提供浅色、深色、跟随系统，以及三种界面风格。

## 资料与隐私

主资料保存在你的 Mac 上，没有账号、服务器或应用网络请求。**资料与备份没有应用级加密**；若主动选用云盘作为额外备份位置，副本由该云盘软件同步。自动备份和主资料同盘，仍应额外保留异地完整备份。

删除应用不会删除资料。更新、换 Mac、资料位置、恢复与当前限制统一见[使用指南](docs/USER_GUIDE.md#update)。反馈时请遮住真实资料，不上传数据库或备份；漏洞请按[安全政策](SECURITY.md)私下报告。

## 文档与参与贡献

- 使用软件：[使用指南](docs/USER_GUIDE.md)，包含安装、入门、模块操作、备份、更新与常见问题。
- 理解计算：[业务规则](docs/PRODUCT_RULES.md)，说明成本、净资产、支出与未知值的口径。
- 参与开发：[贡献指南](CONTRIBUTING.md)、[开发与测试](docs/DEVELOPMENT.md)、[架构说明](docs/ARCHITECTURE.md)。
- 维护项目：[文档职责与维护方式](docs/MAINTAINING.md)、[发布流程](docs/RELEASING.md)、[版本记录](CHANGELOG.md)。

完整文档入口见[文档索引](docs/INDEX.md)。从源码运行需要 Mac、Node.js、Rust 与 Xcode 命令行工具；普通用户直接下载安装包即可。

## 许可

代码按 [GPL-3.0-or-later](LICENSE) 授权，第三方依赖许可见 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES.md)。名称「物谱」「Thingary」与应用图标不在 GPL 授权范围内；修改版再发布请采用自己的名称与图标，详见[品牌使用说明](docs/brand/README.md)。
