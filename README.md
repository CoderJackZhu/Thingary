# 物谱 · Thingary

**Your things and your net worth, over time.** 一个面向 macOS 的本地应用：物品档案与金融净资产盘点并重——记录值得留档的物品，每隔一段时间盘点账户，看清两者如何随时间变化。

主资料保存在你的 Mac 上，没有账号、没有服务器、没有网络请求。资料与备份没有应用级加密；你主动选用云盘作为额外备份位置时，由云盘软件同步副本。

![总览](docs/images/overview-light.png)

<details>
<summary>深色与更多页面</summary>

| | |
|---|---|
| ![总览（深色）](docs/images/overview-dark.png) | ![物品统计（深色）](docs/images/stats-dark.png) |
| ![全部物品](docs/images/assets-light.png) | ![账户与盘点](docs/images/wealth-light.png) |

</details>

> 截图是浏览器预览渲染的同一套界面，数据全部为虚构。

## 它做什么

不做日常小额记账。它面向「低频、值得留档」的东西，大约每月记一次大额支出、贵重物品和账户余额：

- **物品档案**：名称、品牌型号、购入价与日期、渠道、照片、备注；使用中／已退役／已售出的生命周期；维护与保障记录，保障到期可提醒。
- **成本回顾**：日均持有成本、按次成本、售出后的净成本与**售出保值率**，价格不详时标「待补充」，不当作 0。
- **心愿清单**：想买的东西与攒钱进度，实现后一键变成档案。
- **净资产盘点**：账户与负债的定期快照，看金融净资产随时间的变化，以及每个账户各带来多少变化（可选模块）。
- **重要支出、周期费用、虚拟资产**：可单独开关的辅助模块。
- **总览、统计、时间轴**：把以上内容按时间和分类串起来。
- **你的数据你做主**：CSV 导入导出（物品、盘点记录、重要支出、周期费用），完整备份与恢复，自动备份（保留最近 7 天），误删可在「最近删除」找回。
- 浅色／深色／跟随系统，三种界面风格；首次打开有一份可随意修改的虚构样例，不会混进你的资料。

范围边界与每条规则见[产品设计](docs/PRODUCT_DESIGN.md)；操作方法见[使用说明](docs/USER_GUIDE.md)。

## 平台与状态

- 仅 macOS，**只在 Apple Silicon、macOS 27 上验证过**；macOS 14 和 Intel Mac 没有实测，不做承诺。
- 目前没有同步，也没有自动更新。界面暂时只有中文。
- 版本以 [CHANGELOG](CHANGELOG.md) 为准；已知的未验证项见使用说明末尾的「限制」。

## 下载与开始使用

**[下载页面：GitHub Releases](https://github.com/CoderJackZhu/Thingary/releases) · [图文使用说明](docs/USER_GUIDE.md#download)**

选择版本附件中的 `Thingary-<版本>-arm64.dmg`；自动生成的 Source code 是源码，不是安装包。首发仅 Apple Silicon Mac。若当前版本尚无 DMG 附件，请等待安装包发布。

下载 DMG → 打开 → 将「物谱」拖入「应用程序」→ 打开物谱。首发未经过 Developer ID 签名和公证，首次可能需要在「系统设置 › 隐私与安全性」对物谱选择「仍要打开」；[完整安装与故障排查](docs/USER_GUIDE.md#download)有具体步骤，无需编译或使用终端。

进入后可先浏览独立的虚构样例，准备好时点「开始记录我的资料」：

- [记录第一件物品](docs/USER_GUIDE.md#first-record)
- [完成第一次账户盘点](docs/USER_GUIDE.md#first-snapshot)
- [做一次完整备份](docs/USER_GUIDE.md#backup)

更新、换 Mac 与卸载见[使用说明](docs/USER_GUIDE.md#update)。

## 从源码构建

需要一台 Apple Silicon Mac（Rust 部分链接 macOS 原生框架，其他系统无法构建）、Xcode 命令行工具、Node.js 和 Rust 稳定版工具链。

```sh
npm ci                      # 安装锁定的依赖
npm run tauri -- dev        # 开发窗口（使用独立的预览资料，不碰正式资料）
npm run release             # 打包「物谱.app」，位于 src-tauri/target/release/bundle/macos/
```

检查与测试：

```sh
npm run build               # 类型检查与前端构建
npm run test:ui             # 前端纯逻辑检查
npm run check               # cargo fmt 与 clippy
npm test                    # Rust 测试（使用临时目录）
```

没有 Mac 也可以在浏览器里看界面：`npm run dev -- --port 1429`，打开 <http://127.0.0.1:1429/visual-preview.html>（内存中的虚构数据，刷新即重置）。

## 数据放在哪里

正式版的资料在 `~/Library/Application Support/local.thingary.main/`，自动备份在其中的 `library/auto-backups/`。请通过应用管理资料，不要手动改动这个文件夹。删除应用不会删除资料。开发预览与测试使用各自独立的资料位置，互不影响。

## 文档

- [使用说明](docs/USER_GUIDE.md)：安装、资料位置、备份与恢复、当前限制。
- [产品设计](docs/PRODUCT_DESIGN.md)、[技术设计](docs/decisions/001-local-desktop.md)、[竞品调研](docs/COMPETITOR_RESEARCH.md)。
- [文档索引与项目状态](docs/INDEX.md)：全部文档入口与验证记录。
- 参与贡献见 [CONTRIBUTING](CONTRIBUTING.md)，安全问题见 [SECURITY](SECURITY.md)。

## 许可与标志

- 代码按 [GPL-3.0-or-later](LICENSE) 授权；第三方依赖的许可证见 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES.md)。
- **名称「物谱」「Thingary」与应用图标（五线谱标志，见[品牌与图标](docs/brand/README.md)）不在 GPL 授权范围内**，使用权保留：欢迎 fork 和学习代码，但再发布修改版时请换用自己的名称与图标，避免与本项目混淆。
