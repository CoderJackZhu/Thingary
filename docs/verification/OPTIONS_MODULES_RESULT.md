# 默认箱子、选项管理与功能模块 · 隔离原生验收

日期：2026-09-29。授权：用户同意封箱款默认图标与「选项管理」四个标签页，并决定加入功能模块开关（七个可关、关闭时暂停提醒、新用户默认全开）。执行：Claude。**正式 App 与 `local.possio.main` 未打开、未读取、未写入。**

## 环境

隔离身份 `local.possio.opt.acceptance`（配置被忽略），首次启动进入样例库；改前构建来自 `ded3725`（默认箱子重绘之前），改后构建来自当前工作区；窗口 1280×820 浅色。验收后隔离资料（含 `modules.json`）已删除。

## 结果

| 检查 | 结果 |
|---|---|
| 默认箱子 | 列表与详情中无封面物品（虚构便携显示器）由开口箱改为封箱胶带款 |
| 选项管理 | 标题「选项管理」，标签页：分类、购买渠道、售出渠道、状态标签；售出渠道列出闲鱼、转转、线下、朋友转让、回收商、二手平台、其他 |
| 设置中新建状态标签 | 在「状态标签」页新建「虚构闲置」后列表即出现；编辑物品的「自定义状态」选择面板同时显示「活跃中」「虚构闲置」 |
| 关闭心愿与财富四项 | `modules.json` 写入对应 false；侧栏只余总览、我的物品一组、时间轴、统计与底部三项，「财富」组名随之隐藏；总览不再显示「综合回顾」切换，直接为实物概览；时间轴领域只余全部领域／实物，事件类型去掉心愿、支出、盘点，心愿与支出事件不再显示（「购入 · 实现心愿」作为购买事件保留） |
| 全部重新打开 | `modules.json` 全为 true，侧栏与「综合回顾」全部恢复 |

## 同尺寸对照（1280×820，浅色）

| 场景 | 改前 | 改后 |
|---|---|---|
| 物品列表 | [before](../ui/options-modules/before-list.jpg) | [after](../ui/options-modules/after-list.jpg) |
| 无封面物品详情 | [before](../ui/options-modules/before-box-detail.jpg) | [after](../ui/options-modules/after-box-detail.jpg) |
| 设置 | [before](../ui/options-modules/before-settings.jpg) | [after](../ui/options-modules/after-settings.jpg) |

其他：[售出渠道页](../ui/options-modules/after-sale-tab.jpg)、[状态标签页](../ui/options-modules/after-label-tab.jpg)、[关闭模块后的设置](../ui/options-modules/after-modules-off-settings.jpg)、[总览](../ui/options-modules/after-modules-off-overview.jpg)、[时间轴](../ui/options-modules/after-modules-off-timeline.jpg)。

## 自动化

- `modules::tests`：文件缺失或损坏时全部开启；写入读回一致，JSON 使用 `virtual` 键名。
- `u02::switching_the_wishlist_off_pauses_only_its_reminders`：关闭心愿后心愿提醒计划为空，关闭其他模块不影响；心愿本身保留。
- `tests/modules.test.mjs`：各模块只隐藏自己的事件类型；财富四项全关判断。
- 全部 Rust 测试 187 项、clippy、fmt 与界面测试 125 项通过。

## 未验

- 真实系统通知的暂停与恢复未在原生触发（样例不发送通知）；由提醒计划单元测试覆盖。
- 关闭模块后重启 App 的保持：文件已写入并在启动时读取，未单独重启复核。
