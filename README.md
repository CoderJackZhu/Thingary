<p align="center">
  <img src="src-tauri/icons/icon.png" alt="物谱应用图标：谱线与记录点" width="112" height="112">
</p>

<h1 align="center">物谱 · Thingary</h1>

<p align="center"><strong>不用记流水。每月盘一次家底，看看离不上班还有多远。</strong></p>

钱分散在银行卡、余额宝、券商、基金平台、公积金和房贷里，很难看清全貌。物谱是本地使用的桌面应用：每月对照各平台录一次余额和欠款，就能看到净资产变化，并回答三个问题：**每月要存多少、什么时候能不靠工资、歇一阵能撑多久。** 无需账号，不联网也能用，资料只在你的电脑上。

**[下载 Mac 版 0.0.6](https://github.com/CoderJackZhu/Thingary/releases/tag/v0.0.6)**（Apple Silicon 与 Intel）· [快速上手](docs/QUICKSTART.md) · [国内镜像](https://gitee.com/CoderJackZhu/thingary/releases) · [反馈问题](https://github.com/CoderJackZhu/Thingary/issues)

![21 秒界面预览：总览、账户盘点、目标、存钱目标、年度回顾与物品](docs/images/walkthrough.gif)

## 三步开始

1. 下载 `.dmg`，拖入「应用程序」，首次打开可能需要在「系统设置 › 隐私与安全性」选「仍要打开」（[详细步骤](docs/QUICKSTART.md#install)）。
2. 点「开始记录我的资料」，选「先盘点账户」，把各平台余额和欠款录一遍。
3. 到「目标」填目标时间和每月能存的钱，看三个问题的答案。之后每月或每季盘一次即可。

## 能做什么

| | |
|---|---|
| **账户盘点** | 定期核对资产与负债，看净资产趋势；支持房产、个人养老金、保险、黄金等账户类型 |
| **目标与规划** | 反算每月要存多少、估算财务独立时间；比较购买、休息或换工作的影响 |
| **存钱目标与年度回顾** | 为一笔钱设目标并随盘点看进度；按年回看盘点、收入、重要支出 |
| **物品档案（可选）** | 价格、照片、维修与保障，日均成本；周期费用与虚拟资产可按需打开 |
| **资料保护** | 完整备份、自动备份、最近删除；备份可用你保管的恢复密钥加密 |

它适合低频记录，不提供日常流水记账、行情交易或自动付款。

## 资料与隐私

资料只在本机，没有账号，平时不联网（只有你点「检查更新」时才查询公开版本列表）。主资料库和图片未加密，备份可选加密；自动备份和主资料同盘，请另外保留一份异地备份。详见[隐私与资料安全](docs/USER_GUIDE.md#privacy)。

## 支持范围

Mac：已在 Apple Silicon、macOS 27 验证，安装包同时含 Intel，最低目标 macOS 14（Intel 与旧系统尚未实机验证）。Windows 0.0.7 是未签名候选版，尚未公开发布。已知限制见[快速上手](docs/QUICKSTART.md#limits)。

## 文档

[快速上手](docs/QUICKSTART.md)（一页）· [完整使用指南](docs/USER_GUIDE.md) · [业务规则](docs/PRODUCT_RULES.md) · [版本记录](CHANGELOG.md) · [文档索引](docs/INDEX.md)。参与开发见[贡献指南](CONTRIBUTING.md)与[开发说明](docs/DEVELOPMENT.md)，漏洞请按[安全政策](SECURITY.md)私下报告。

## 许可

规划计算由独立的 Rust 核心实现，来源与许可说明见[来源告知](SOURCE_NOTICES.md)，接口与构建见[核心说明](crates/planning-engine/README.md)。

代码按 [AGPL-3.0-or-later](LICENSE) 授权（0.0.4 及更早版本发布时标注为 GPL-3.0-or-later），第三方依赖许可见 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES.md)。名称「物谱」「Thingary」与应用图标不在 AGPL 授权范围内；修改版再发布请采用自己的名称与图标，详见[品牌使用说明](docs/brand/README.md)。
