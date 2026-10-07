# 直接内置内容的来源告知

锁定依赖的许可另见 `THIRD_PARTY_LICENSES.md` 与随包 `THIRD_PARTY_NOTICES.txt`。本文件覆盖直接写入项目的已登记外部内容。

## Mulberry32

位置：`src/plan-risk.ts` 的 `mulberry32`。用于复现市场模拟的随机序列，不用于安全或密码学。

算法作者：Tommy Ettinger，2017。原始实现作者声明将相关权利按 CC0 贡献至公共领域，不提供保证：

- 原始 C 实现与声明：<https://gist.github.com/tommyettinger/46a874533244883189143505d203312c>
- CC0 1.0：<https://creativecommons.org/publicdomain/zero/1.0/>
- JavaScript 参考：bryc 的 PRNG 说明，文件开头声明 public domain：<https://github.com/bryc/code/blob/master/jshash/PRNGs.md>

本项目保留算法运算，增加种子转换与显式 32 位截断。以上是已核实的算法参考；本项目最初创建时实际取用哪个版本没有检索到记录，不能据此声称某份 JavaScript 改写来自原始 C 作者。其他来源各自的许可不能由此改变。

## 规划模块

早期参考来源：[Wealthfolio](https://github.com/wealthfolio/wealthfolio/tree/51cdbf92e2738c6e8c58fa9f04ae630125549043)，[上游许可 AGPL-3.0](https://github.com/wealthfolio/wealthfolio/blob/51cdbf92e2738c6e8c58fa9f04ae630125549043/LICENSE)。历史内容的许可适用范围仍需核对。
