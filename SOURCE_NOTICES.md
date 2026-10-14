# 直接内置内容的来源告知

锁定依赖的许可另见 `THIRD_PARTY_LICENSES.md` 与随包 `THIRD_PARTY_NOTICES.txt`。本文件覆盖直接写入项目的已登记外部内容及历史来源。

## 当前规划计算核心

`crates/planning-engine` 在独立上下文的隔离实现环境中，根据冻结的行为规格编写，未向实现者提供旧源码、旧测试、上游截图或原场景预设。实现环境只挂载规格与自己的输出目录，禁止直接联网；模型请求经固定宿主中转发送，宿主登录凭据不进入实现环境。规格、审计与接入人员曾接触旧实现，这些职责与独立实现者分开。详细输入散列、访问和构建记录由维护者保留。

当前市场模拟使用该 Rust 核心自行实现的 SplitMix64 序列与正态采样，不再调用历史 Mulberry32 实现。桌面应用的同步计算和浏览器预览使用同一核心的 WebAssembly；桌面市场模拟的异步批次及汇总通过原生 Rust 命令执行。TypeScript 仍负责资料编译、事件付款输入、来源核对、产品结果编排与展示。

隔离重建说明仅覆盖新的 Rust 计算核心，不覆盖全部规划界面、历史版本或数据适配层，也不构成法律风险已消除的结论。整体项目继续按 AGPL-3.0-or-later 授权，历史来源和许可记录保持有效。核心接口与验证方式见 [计算核心说明](crates/planning-engine/README.md)。

## 历史实现：Mulberry32

历史位置：`src/plan-risk.ts` 的 `mulberry32`。原用于复现市场模拟的随机序列，不用于安全或密码学。当前 Rust 计算核心已替换这段实现；以下记录为历史版本及其再分发保留。

算法作者：Tommy Ettinger，2017。原始实现作者声明将相关权利按 CC0 贡献至公共领域，不提供保证：

- 原始 C 实现与声明：<https://gist.github.com/tommyettinger/46a874533244883189143505d203312c>
- CC0 1.0：<https://creativecommons.org/publicdomain/zero/1.0/>
- JavaScript 参考：bryc 的 PRNG 说明，文件开头声明 public domain：<https://github.com/bryc/code/blob/master/jshash/PRNGs.md>

历史实现保留算法运算，增加种子转换与显式 32 位截断。以上是已核实的算法参考；本项目最初创建时实际取用哪个版本没有检索到记录，不能据此声称某份 JavaScript 改写来自原始 C 作者。其他来源各自的许可不能由此改变。

## 历史实现：规划模块

早期参考来源：[Wealthfolio](https://github.com/wealthfolio/wealthfolio/tree/51cdbf92e2738c6e8c58fa9f04ae630125549043)，[上游许可 AGPL-3.0](https://github.com/wealthfolio/wealthfolio/blob/51cdbf92e2738c6e8c58fa9f04ae630125549043/LICENSE)。在本次 Rust 核心隔离重建之前，曾重写已定位的复用内容；那次历史重写不是洁净室实现，与上文的新核心隔离实现是两次不同的工作。为与上游许可保持一致，本项目自 2026-10-13 起整体按 AGPL-3.0-or-later 授权。0.0.4 及更早版本发布时标注为 GPL-3.0-or-later，重新分发这些旧版本时同样按上游 AGPL-3.0 处理相关部分。
