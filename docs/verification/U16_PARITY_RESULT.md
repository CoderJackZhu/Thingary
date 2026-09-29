# U16 接续实现与验收记录

日期：2026-09-30。分支：`claude/u16-parity`。用户授权接续 Claude 未完成的工作并先推送；不合并 main、不安装正式版。

## 结论与边界

Claude 停在 `209be0a`：U16a–c 的主要代码已推送，U16d 尚未开始。本次补齐 U16d–f 的主要实现与可审阅证据；**不将构建通过或截图齐全等同于“设计完全对齐”**。阶段视觉出口仍待逐项收口，具体差异见下表。正式资料库未打开、未写入；原生检查只使用 `local.possio.u16.acceptance` 与应用自带独立虚构样例。

## 接续提交

- `d1e4145`：物品详情卡片、备注合并、面包屑返回、Esc 返回与焦点恢复，检视器单一打开档案操作。
- `04bedb0`：心愿网格与内联检视器，保留编辑、提醒、删除、放弃、转物品和攒钱；保留未知结果回执及关闭保护。
- `87380c6`：财富与回顾页面使用共用组件；虚拟资产检视器；时间轴整行来源跳转；最近删除表格；设置图标；移除无引用旧样式；页头 portal；菜单方向键；侧栏计数随列表刷新。
- 本记录同次提交：统计全量区块两列网格、截图与接续状态。

## 验证

| 检查 | 结果 |
|---|---|
| `npm run build` | TypeScript 与 Vite 通过 |
| `npm run test:ui` | 150/150 通过，含六种主题组合正文、次要文字、链接、状态色在 selected 等表面的 4.5:1 对比度检查 |
| `npm run check` | Rust fmt / clippy 通过 |
| `npm test` | macOS 沙箱外 216/216 通过；沙箱内 HEIC 解码受限，重新在沙箱外跑完整套通过 |
| 隔离原生 debug bundle | Tauri 构建与本地签名通过；未公证，未安装到 Applications |
| 1280×820 | 50 组应用与设计稿对照图；B 全 15 屏浅深色，C/D 各 5 屏浅深色；另补组件页 C/D 四组 |
| 800×600 | 14 个业务页面无 document 横向溢出、无页面读取错误；截图为 `*-narrow.png`，检视器在窄窗下移到列表后 |
| 原生物品 | 打开档案焦点在标题；Esc 回列表且保持选择与焦点；浏览器另验证菜单 Esc 不穿透成返回 |
| 原生心愿 | 虚构旅行镜头 +100 后，已攒 1500→1600，剩余 1500→1400，进度 50%→53%，显示保存成功；更多菜单保留编辑与提醒、删除 |
| 原生主题 | 设置页三主题×浅深色抽查；⌘⇧D 切换成功 |
| 原生小折线 | 聚焦后左键显示 2026-07-30 / ¥327,600 / +3.31%，即时浮层可见；Esc 收起 |
| 可访问性 | AX 可识别侧栏、主题选项、图表名、详情焦点；未启用 VoiceOver 做实际朗读验收，不宣称通过该项 |

原生交互验收在最终统计网格 CSS 调整前执行；这些交互的生产代码相同，最后另做构建验证。浏览器统计 adapter 仅用于画面样例（持有分组简化为一组），不作为统计计算正确性的证据。原生计算由 Rust 测试覆盖。

## 仍未关闭的视觉出口

1. 规范组件页是应用组件样本，不是设计稿说明页的逐像素复刻；组件形态可比，整页构图不可判为零差异。
2. 全局顶栏仍保留原有页面上下文、搜索策略与新增记录入口；设计稿的静态示例在个别页不同。需要以规范核对最终视觉取舍，不能默认用户已批准差异。
3. 详情实际保障、维护与备注内容较多，区块高度高于静态稿；表单保留已有字段和操作。已有功能不因静态稿省略而删除。
4. 统计保留规范 6.13 指定的全部区块，采用两列网格；静态稿简化后的区块次序不同。以规范为准，但不能据此声称逐像素一致。
5. 真实 VoiceOver 朗读与最终视觉出口尚未通过；本分支可审阅，不是正式发布验收通过。

## 证据入口与复现

截图位于 [capture](../ui/u16/capture/)，下表每行对应一组。少数截图右侧粉色浮标来自浏览器扩展，不属于应用；原生截图没有该浮标。设计稿工具条被隐藏，框架与应用均为 1280×820。图片、文本、记录数与日期来自各自虚构样例，不一致不代表计算缺陷。

浏览器复现：启动 `npm run dev -- --port 1429`，在仓库根目录运行 `ego-browser nodejs < docs/ui/u16/capture.mjs`。脚本通过设置页真实控件选主题，截图仅操作本地预览。它会新建自己的 TaskSpace，结束后关闭自己的页面。原生构建使用忽略目录 `.local/u16.conf.json`，identifier 必须为 `local.possio.u16.acceptance`；不要替换成正式身份。

| 页面 / 主题 / 模式 | 应用 | 设计稿 | 差异说明 |
|---|---|---|---|
| spec-native-light | [应用](../ui/u16/capture/spec-native-light-app.png) | [设计稿](../ui/u16/capture/spec-native-light-mockup.png) | 组件样本页与规范说明页内容不同；比较令牌/组件，不判整页零差异。 |
| overview-native-light | [应用](../ui/u16/capture/overview-native-light-app.png) | [设计稿](../ui/u16/capture/overview-native-light-mockup.png) | 相同两主卡、指标、关注/近期结构；样例记录与未知金额披露造成高度差。 |
| items-native-light | [应用](../ui/u16/capture/items-native-light-app.png) | [设计稿](../ui/u16/capture/items-native-light-mockup.png) | 选中物品、分类数、金额不同；保留现有筛选与总数披露。 |
| detail-native-light | [应用](../ui/u16/capture/detail-native-light-app.png) | [设计稿](../ui/u16/capture/detail-native-light-mockup.png) | 相机与电脑样例不同；实际维护和保障内容较多，卡片高度不同；菜单截图状态不同。 |
| form-native-light | [应用](../ui/u16/capture/form-native-light-app.png) | [设计稿](../ui/u16/capture/form-native-light-mockup.png) | 保留全部现有字段，滚动长度不同；未裁掉业务功能。 |
| wish-native-light | [应用](../ui/u16/capture/wish-native-light-app.png) | [设计稿](../ui/u16/capture/wish-native-light-mockup.png) | 卡片与内联检视器结构已落地；虚构预览为倒计时，原生另覆盖攒钱。 |
| accounts-native-light | [应用](../ui/u16/capture/accounts-native-light-app.png) | [设计稿](../ui/u16/capture/accounts-native-light-mockup.png) | 保留纵轴、资产结构与负债、完整账户清单；数据和高度不同。 |
| stock-native-light | [应用](../ui/u16/capture/stock-native-light-app.png) | [设计稿](../ui/u16/capture/stock-native-light-mockup.png) | 当前日期已有盘点，显示更正说明；静态稿是新建示例。 |
| expenses-native-light | [应用](../ui/u16/capture/expenses-native-light-app.png) | [设计稿](../ui/u16/capture/expenses-native-light-mockup.png) | 图表数值与来源标签齐全；年月样例与明细数量不同。 |
| recurring-native-light | [应用](../ui/u16/capture/recurring-native-light-app.png) | [设计稿](../ui/u16/capture/recurring-native-light-mockup.png) | 仅首条待确认实心按钮；实际待确认和计划数量不同。 |
| virtual-native-light | [应用](../ui/u16/capture/virtual-native-light-app.png) | [设计稿](../ui/u16/capture/virtual-native-light-mockup.png) | 表格与检视器齐全；保留原有指标与状态筛选，静态稿较精简。 |
| timeline-native-light | [应用](../ui/u16/capture/timeline-native-light-app.png) | [设计稿](../ui/u16/capture/timeline-native-light-mockup.png) | 月份、日期、类型、金额与整行来源齐全；事件文本数量不同，筛选保留原有能力。 |
| stats-native-light | [应用](../ui/u16/capture/stats-native-light-app.png) | [设计稿](../ui/u16/capture/stats-native-light-mockup.png) | 规范要求的完整分析区块保留并两列化，静态稿区块较少；不按静态稿删功能。 |
| trash-native-light | [应用](../ui/u16/capture/trash-native-light-app.png) | [设计稿](../ui/u16/capture/trash-native-light-mockup.png) | 虚构已删除旧电脑一条；表格结构齐全，数量与内容不同。 |
| settings-native-light | [应用](../ui/u16/capture/settings-native-light-app.png) | [设计稿](../ui/u16/capture/settings-native-light-mockup.png) | 主题选中状态与实际主题一致；保留原有说明与跟随系统选项。 |
| spec-native-dark | [应用](../ui/u16/capture/spec-native-dark-app.png) | [设计稿](../ui/u16/capture/spec-native-dark-mockup.png) | 组件样本页与规范说明页内容不同；比较令牌/组件，不判整页零差异。 |
| overview-native-dark | [应用](../ui/u16/capture/overview-native-dark-app.png) | [设计稿](../ui/u16/capture/overview-native-dark-mockup.png) | 相同两主卡、指标、关注/近期结构；样例记录与未知金额披露造成高度差。 |
| items-native-dark | [应用](../ui/u16/capture/items-native-dark-app.png) | [设计稿](../ui/u16/capture/items-native-dark-mockup.png) | 选中物品、分类数、金额不同；保留现有筛选与总数披露。 |
| detail-native-dark | [应用](../ui/u16/capture/detail-native-dark-app.png) | [设计稿](../ui/u16/capture/detail-native-dark-mockup.png) | 相机与电脑样例不同；实际维护和保障内容较多，卡片高度不同；菜单截图状态不同。 |
| form-native-dark | [应用](../ui/u16/capture/form-native-dark-app.png) | [设计稿](../ui/u16/capture/form-native-dark-mockup.png) | 保留全部现有字段，滚动长度不同；未裁掉业务功能。 |
| wish-native-dark | [应用](../ui/u16/capture/wish-native-dark-app.png) | [设计稿](../ui/u16/capture/wish-native-dark-mockup.png) | 卡片与内联检视器结构已落地；虚构预览为倒计时，原生另覆盖攒钱。 |
| accounts-native-dark | [应用](../ui/u16/capture/accounts-native-dark-app.png) | [设计稿](../ui/u16/capture/accounts-native-dark-mockup.png) | 保留纵轴、资产结构与负债、完整账户清单；数据和高度不同。 |
| stock-native-dark | [应用](../ui/u16/capture/stock-native-dark-app.png) | [设计稿](../ui/u16/capture/stock-native-dark-mockup.png) | 当前日期已有盘点，显示更正说明；静态稿是新建示例。 |
| expenses-native-dark | [应用](../ui/u16/capture/expenses-native-dark-app.png) | [设计稿](../ui/u16/capture/expenses-native-dark-mockup.png) | 图表数值与来源标签齐全；年月样例与明细数量不同。 |
| recurring-native-dark | [应用](../ui/u16/capture/recurring-native-dark-app.png) | [设计稿](../ui/u16/capture/recurring-native-dark-mockup.png) | 仅首条待确认实心按钮；实际待确认和计划数量不同。 |
| virtual-native-dark | [应用](../ui/u16/capture/virtual-native-dark-app.png) | [设计稿](../ui/u16/capture/virtual-native-dark-mockup.png) | 表格与检视器齐全；保留原有指标与状态筛选，静态稿较精简。 |
| timeline-native-dark | [应用](../ui/u16/capture/timeline-native-dark-app.png) | [设计稿](../ui/u16/capture/timeline-native-dark-mockup.png) | 月份、日期、类型、金额与整行来源齐全；事件文本数量不同，筛选保留原有能力。 |
| stats-native-dark | [应用](../ui/u16/capture/stats-native-dark-app.png) | [设计稿](../ui/u16/capture/stats-native-dark-mockup.png) | 规范要求的完整分析区块保留并两列化，静态稿区块较少；不按静态稿删功能。 |
| trash-native-dark | [应用](../ui/u16/capture/trash-native-dark-app.png) | [设计稿](../ui/u16/capture/trash-native-dark-mockup.png) | 虚构已删除旧电脑一条；表格结构齐全，数量与内容不同。 |
| settings-native-dark | [应用](../ui/u16/capture/settings-native-dark-app.png) | [设计稿](../ui/u16/capture/settings-native-dark-mockup.png) | 主题选中状态与实际主题一致；保留原有说明与跟随系统选项。 |
| overview-paper-light | [应用](../ui/u16/capture/overview-paper-light-app.png) | [设计稿](../ui/u16/capture/overview-paper-light-mockup.png) | 相同两主卡、指标、关注/近期结构；样例记录与未知金额披露造成高度差。 |
| items-paper-light | [应用](../ui/u16/capture/items-paper-light-app.png) | [设计稿](../ui/u16/capture/items-paper-light-mockup.png) | 选中物品、分类数、金额不同；保留现有筛选与总数披露。 |
| detail-paper-light | [应用](../ui/u16/capture/detail-paper-light-app.png) | [设计稿](../ui/u16/capture/detail-paper-light-mockup.png) | 相机与电脑样例不同；实际维护和保障内容较多，卡片高度不同；菜单截图状态不同。 |
| timeline-paper-light | [应用](../ui/u16/capture/timeline-paper-light-app.png) | [设计稿](../ui/u16/capture/timeline-paper-light-mockup.png) | 月份、日期、类型、金额与整行来源齐全；事件文本数量不同，筛选保留原有能力。 |
| settings-paper-light | [应用](../ui/u16/capture/settings-paper-light-app.png) | [设计稿](../ui/u16/capture/settings-paper-light-mockup.png) | 主题选中状态与实际主题一致；保留原有说明与跟随系统选项。 |
| overview-paper-dark | [应用](../ui/u16/capture/overview-paper-dark-app.png) | [设计稿](../ui/u16/capture/overview-paper-dark-mockup.png) | 相同两主卡、指标、关注/近期结构；样例记录与未知金额披露造成高度差。 |
| items-paper-dark | [应用](../ui/u16/capture/items-paper-dark-app.png) | [设计稿](../ui/u16/capture/items-paper-dark-mockup.png) | 选中物品、分类数、金额不同；保留现有筛选与总数披露。 |
| detail-paper-dark | [应用](../ui/u16/capture/detail-paper-dark-app.png) | [设计稿](../ui/u16/capture/detail-paper-dark-mockup.png) | 相机与电脑样例不同；实际维护和保障内容较多，卡片高度不同；菜单截图状态不同。 |
| timeline-paper-dark | [应用](../ui/u16/capture/timeline-paper-dark-app.png) | [设计稿](../ui/u16/capture/timeline-paper-dark-mockup.png) | 月份、日期、类型、金额与整行来源齐全；事件文本数量不同，筛选保留原有能力。 |
| settings-paper-dark | [应用](../ui/u16/capture/settings-paper-dark-app.png) | [设计稿](../ui/u16/capture/settings-paper-dark-mockup.png) | 主题选中状态与实际主题一致；保留原有说明与跟随系统选项。 |
| overview-bento-light | [应用](../ui/u16/capture/overview-bento-light-app.png) | [设计稿](../ui/u16/capture/overview-bento-light-mockup.png) | 相同两主卡、指标、关注/近期结构；样例记录与未知金额披露造成高度差。 |
| items-bento-light | [应用](../ui/u16/capture/items-bento-light-app.png) | [设计稿](../ui/u16/capture/items-bento-light-mockup.png) | 选中物品、分类数、金额不同；保留现有筛选与总数披露。 |
| detail-bento-light | [应用](../ui/u16/capture/detail-bento-light-app.png) | [设计稿](../ui/u16/capture/detail-bento-light-mockup.png) | 相机与电脑样例不同；实际维护和保障内容较多，卡片高度不同；菜单截图状态不同。 |
| timeline-bento-light | [应用](../ui/u16/capture/timeline-bento-light-app.png) | [设计稿](../ui/u16/capture/timeline-bento-light-mockup.png) | 月份、日期、类型、金额与整行来源齐全；事件文本数量不同，筛选保留原有能力。 |
| settings-bento-light | [应用](../ui/u16/capture/settings-bento-light-app.png) | [设计稿](../ui/u16/capture/settings-bento-light-mockup.png) | 主题选中状态与实际主题一致；保留原有说明与跟随系统选项。 |
| overview-bento-dark | [应用](../ui/u16/capture/overview-bento-dark-app.png) | [设计稿](../ui/u16/capture/overview-bento-dark-mockup.png) | 相同两主卡、指标、关注/近期结构；样例记录与未知金额披露造成高度差。 |
| items-bento-dark | [应用](../ui/u16/capture/items-bento-dark-app.png) | [设计稿](../ui/u16/capture/items-bento-dark-mockup.png) | 选中物品、分类数、金额不同；保留现有筛选与总数披露。 |
| detail-bento-dark | [应用](../ui/u16/capture/detail-bento-dark-app.png) | [设计稿](../ui/u16/capture/detail-bento-dark-mockup.png) | 相机与电脑样例不同；实际维护和保障内容较多，卡片高度不同；菜单截图状态不同。 |
| timeline-bento-dark | [应用](../ui/u16/capture/timeline-bento-dark-app.png) | [设计稿](../ui/u16/capture/timeline-bento-dark-mockup.png) | 月份、日期、类型、金额与整行来源齐全；事件文本数量不同，筛选保留原有能力。 |
| settings-bento-dark | [应用](../ui/u16/capture/settings-bento-dark-app.png) | [设计稿](../ui/u16/capture/settings-bento-dark-mockup.png) | 主题选中状态与实际主题一致；保留原有说明与跟随系统选项。 |
| spec-paper-light（补充） | [应用](../ui/u16/capture/spec-paper-light-app.png) | [设计稿](../ui/u16/capture/spec-paper-light-mockup.png) | 组件样本与规范说明内容不同，只比较组件形态。 |
| spec-paper-dark（补充） | [应用](../ui/u16/capture/spec-paper-dark-app.png) | [设计稿](../ui/u16/capture/spec-paper-dark-mockup.png) | 组件样本与规范说明内容不同，只比较组件形态。 |
| spec-bento-light（补充） | [应用](../ui/u16/capture/spec-bento-light-app.png) | [设计稿](../ui/u16/capture/spec-bento-light-mockup.png) | 组件样本与规范说明内容不同，只比较组件形态。 |
| spec-bento-dark（补充） | [应用](../ui/u16/capture/spec-bento-dark-app.png) | [设计稿](../ui/u16/capture/spec-bento-dark-mockup.png) | 组件样本与规范说明内容不同，只比较组件形态。 |
