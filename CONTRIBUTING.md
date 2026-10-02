# 参与贡献

物谱 Thingary 是一个个人项目，范围刻意收得很窄。欢迎 issue 和 PR，但请先读完下面几条，能省下双方的时间。

## 先开 issue 再写代码

较大的改动（新功能、改规则、改界面结构）请先开 issue 说明想解决的问题。产品范围以[产品设计](docs/PRODUCT_DESIGN.md)为准，**这些方向不接受**：日常流水记账、云同步与账号、AI 功能、按量／按使用时长的成本模式、对金融资产的行情与交易。小的缺陷修复和文字更正可以直接提 PR。

## 开发环境

需要 Apple Silicon Mac（Rust 部分链接 macOS 原生框架）。步骤见 [README](README.md#从源码构建)。提交前请跑通：

```sh
npm run build && npm run test:ui && npm run check && npm test
```

- 改了计算或数据语义，请同时更新相应测试样例；涉及界面，请覆盖正常、缺失、空白和错误状态。
- 不要在测试里使用真实资料；样例与测试数据一律虚构。
- 开发与测试只用开发预览身份（`local.possio.preview`）或临时目录，**不要打开或写入正式版的资料库**（`~/Library/Application Support/local.possio.main/`）。
- 界面改动请复用已有的 SVG、令牌（`src/theme.css`）和组件，并附同尺寸的改前改后截图。

## 代码约定

- 技术栈：Tauri 2、React、TypeScript、Rust、SQLite。写法请贴近周围代码的命名、注释密度和风格。
- 金额用整数分，不用浮点数；日期用 `YYYY-MM-DD` 字符串。
- 未知值保持为空（界面显示「待补充」），不要当作 0。
- 普通表单直接关闭、不保存草稿；已提交但结果未知的请求要保留并核对。
- 故障注入 feature（`fault-injection`）只用于测试。

## 提交与 PR

- 一个 PR 做一件事，提交信息写清楚「做了什么、为什么」。
- 版本号只由维护者在发布时修改（`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 四处保持一致）。
- CHANGELOG 由维护者在发布时整理，PR 里不必改。

## 许可

你的贡献按本项目的许可证 [GPL-3.0-or-later](LICENSE) 授权。名称「物谱」「Thingary」与应用图标不在 GPL 授权范围内，贡献代码不涉及这些标志。
