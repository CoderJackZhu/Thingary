# 图标选择器与外观切换

日期：2026-09-27。用户确认名称左侧默认图标、按来源与分类选择素材，以及更完整的太阳／月亮切换。实现位于 `codex/asset-icon-picker`；正式资料库未打开或用于测试。

## 交付范围

- 名称左侧默认箱子；点击打开选择器，预览后确认；支持恢复默认。
- 50 个原创线条图标，覆盖用户列出的设备、家电、厨具；保留原有 8 张立体示意图。清单与图形定义统一在 `src-tauri/materials/materials.json`，离线 PNG 随 App 内嵌。
- 图标／立体图标／最近／我的图片；名称和别名搜索，分类筛选，当前选择预览、选中状态和固定底部操作。
- 自有图片可系统选图、拖入或粘贴；原有图片解码、大小限制与资料库身份检查继续生效。
- 图片附件独立折叠。连续更换临时图标不累积附件；替换已保存封面保留原照片。默认箱子不占 20 张图片额度。
- 左下角太阳／月亮胶囊，高亮当前状态，短滑动反馈；减少动态效果偏好下关闭动画，设置保留跟随系统。
- 不改业务 schema，不改变资产名称、价格、日期、分类或已有图片文件。自定义素材继续沿用 schema 9 和完整备份。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 前端构建 | TypeScript 与 Vite 通过 |
| 前端测试 | 88/88；覆盖所有指定图标、别名／来源／分类组合、最近使用隔离、图片替换及数量边界 |
| Rust 格式及 Clippy | 通过，无警告 |
| 素材存储测试 | 8/8；内嵌素材可读、旧 ID 兼容、自定义上传／删除引用与恢复 |
| 图片测试 | 6/6；沙盒内 ImageIO 解码受限，沙盒外使用临时虚构文件重跑通过 |
| 浏览器交互 | SSD 别名搜索、最近、默认恢复、名称不被修改、取消、拖入虚构 PNG、准备失败保留输入通过 |
| 800×600 浏览器布局 | 选择器 760×544，底栏 y=501–571，结果区独立滚动；单一模态窗口 |
| 原生 1280×840 | 默认表单、浅／深色切换、选择笔记本图标、保存虚构资产、退出重开后图标和日期保持 |
| 原生 800×600 | 深色选择器底部按钮可见，图标区可滚动，分类与来源可访问 |

原生身份分别为 `local.possio.icon.acceptance` 与 `local.possio.icon.small.acceptance`，均为虚构隔离资料。实际测试发现 WebKit 多模态层使选择器控件无法被辅助操作工具读取，已改为同一个原生模态窗口内切换内容；修复后可读取所有图标及操作按钮。搜索框保留单层焦点提示，返回恢复头像按钮焦点。

浏览器预览采用模拟存储，不能证明原生持久性；持久性以独立原生保存／重开为依据。拖入已验证浏览器事件与既有原生图片存储链路，尚未通过 Mac GUI 手动投递文件或图片剪贴板完成端到端补验。VoiceOver 完整流程仍沿用既有待验边界。

## 视觉证据

- [新增表单](icon-picker/editor-light.png)
- [浅色选择器](icon-picker/picker-light.png)
- [小窗口深色选择器](icon-picker/picker-small-dark.png)
- [原生小窗口控件](icon-picker/picker-small-native.txt)
- [重开后的图标](icon-picker/reopened-native.png)与[控件记录](icon-picker/reopened-native.txt)
- [深色主窗口与外观胶囊](icon-picker/shell-dark.png)

## 实现与复现

`npm run build`、`npm run test:ui`、`npm run check`；存储检查：`cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test materials --test photos`。macOS 图片解码需要允许 ImageIO 正常运行。

图标原图生成入口：`scripts/render-material-icons.mjs`，参数为本机 sharp 包路径。它根据素材清单生成新增 PNG 及 Rust 嵌入清单，原有八张插图继续使用原生成脚本。

窗口关闭 Tauri 自带文件拖放接管，使用 HTML 文件拖放；配置依据为 [Tauri 官方 dragDropEnabled 文档](https://v2.tauri.app/reference/config/#dragdropenabled)。新增字节导入命令仍委托原 `stage_photo`，检查大小、实际图片内容与当前资料库 generation。

## 安装状态

`npm run release` 已成功。用户确认保存并退出后，已安装到 `/Applications/物志.app`，身份保持 `local.possio.main`。安装前后及正式构建的二进制 SHA256 一致：`054b0c3f99f6bd327814fb278efce63b8b02253b1c5d7fefe09bab090f0d0aae`。

旧包保留在 `/private/tmp/物志-before-icon-picker-20260927.app`。仅替换 App 包，未启动正式版、未打开或写入正式资料库。浏览器验收空间已关闭；隔离原生窗口只使用虚构资料。
