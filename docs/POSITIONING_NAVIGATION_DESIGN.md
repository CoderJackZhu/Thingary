# 定位、导航与首次使用调整

**状态：已实施。** 核对基线 `71250737e7074496702f0b7678a5f0ac8aaf71dd`。本文保留已批准的目标行为与验收条件；现行操作以[使用指南](USER_GUIDE.md)和[业务规则](PRODUCT_RULES.md)为准，实施状态见 [INDEX](INDEX.md)，当前验证边界见[开发说明](DEVELOPMENT.md)。

## 1. 背景与目标

物谱同时有物品档案、账户盘点与目标规划三类功能。对外介绍若逐项列举模块，陌生用户难以判断是否适合自己；界面上侧栏入口多、规划深度只露出一页、首次使用缺少明确起点。

本轮用一种**使用方式**统一现有功能，不新增业务能力：

> 给记账坚持不下来的人：不用每天记流水。重要的东西留个档，每月盘一次钱，需要时算算未来。

- 物品档案与账户盘点是两个并列起点，只用其中一个也完整成立。
- 规划是盘点之上的回答层：已保存的目标、可核对的测算详情、临时试算三者分开呈现。
- 周期费用与虚拟资产保留为辅助模块。

## 2. 不变量

以下内容本轮**不得改变**：

- 数据库 schema、备份格式、Excel 结构、请求回执与恢复语义。
- 金额、日期、未知值、计入口径与全部计算结果；仅改用户可见文案，不改内部标识、错误码、字段名。
- `Modules::default()`（`src-tauri/src/modules.rs`）及偏好文件缺失时的继承行为。模块显隐只通过用户在界面上的明确选择写入。
- 物品列表查询接口与 `asset_counts` 返回结构。
- 样例库与正式库隔离；开发验收只用 `local.thingary.preview` 或临时目录及虚构资料。
- 关闭表单不保存普通草稿；已提交但结果未知的回执继续保留并核对。
- 新界面复用 `ui-seg`、`HeaderSlot`、`Info`、`FormRow`、`details.more-fields` 等现有组件与 `src/theme.css` 令牌，不引入依赖。

## 3. 物品导航收拢

### 3.1 侧栏

“物品”分组只保留：

| 入口 | 行为 |
|---|---|
| 全部物品 | `browseStatus('all', 'all')`；右侧数量用 `sideCounts.all` |
| 心愿清单 | 不变（受 `modules.wishlist` 控制） |
| 物品统计 | 不变（受 `modules.stats` 控制） |

移除侧栏中的“使用中、保障中、已退役、已售出”四个入口（`src/main.tsx` 的 `statusItems` 与其渲染）。

### 3.2 列表状态切换

在物品列表 `collection-toolbar` 内、分类筛选之前，加一个 `ui-seg` 分段控件：

| 选项 | `query.filter` | 数量 |
|---|---|---|
| 全部 | `all` | `sideCounts.all` |
| 使用中 | `active` | `sideCounts.active` |
| 已退役 | `retired` | `sideCounts.retired` |
| 已售出 | `sold` | `sideCounts.sold` |

- 用 `aria-pressed` 表示当前项，`role="group"`、`aria-label="物品状态"`。数量为 `null` 时不显示数字，不显示 0。
- `query.filter` 同时承载“金额待补充／日期待补充”。当筛选弹层把 `filter` 设为 `missing_price` 或 `missing_date` 时，分段控件**无选中项**；点任一分段即覆盖该资料筛选。这是现有单字段查询的直接结果，不拆分查询字段。
- “保障中”不再是独立入口：沿用筛选弹层中已有的“保障 › 有有效保障”（`warranty: 'covered'`）。
- 切换分段只改 `filter` 并回到第一页，保留分类、标签、搜索与排序。
- 窄窗口下分段控件可换行到工具栏第二行，不出现横向滚动。

### 3.3 标题与面包屑

- 页面标题由当前筛选推导：分段为使用中／已退役／已售出时用对应名称；保障筛选为 `covered` 且分段为全部时显示“保障中”；其余显示“全部物品”。替换现有 `collectionTitle` 对 `statusItems` 的依赖，详情页返回链接沿用同一标题。
- 面包屑第一段“我的物品”改为“物品”，与侧栏分组一致。
- 心愿清单面包屑第二段“购买前记录”改为“心愿清单”，与页面标题一致。

### 3.4 验收

- 侧栏物品分组只剩三项；原四个状态从列表内一次点击可达，数量与原侧栏一致。
- 从详情返回、从总览／统计跳入物品列表、全局搜索打开物品后，标题、分段选中和列表结果一致。
- 资料筛选与分段互斥的表现符合 3.2；“清除条件”同时清空两者。
- 浅色／深色、宽窗／窄窗，正常、空白（`从第一件物品开始`）、筛选无结果、读取失败四种状态截图。

## 4. 规划页内标签

### 4.1 结构

规划仍是侧栏一个入口“目标”。页面在 `HeaderSlot` 中加入 `ui-seg` 标签（`aria-label="规划视图"`），与现有 `Info` 并列：

| 标签 | 内容 | 现有来源 |
|---|---|---|
| 目标 | 假设摘要、条件四问与当前结论、核算注意事项、大额计划、安排发生核对、“查看当前报告” | `AssumptionsSummary`、`GoalOverview`、`PlanningRefinements`、`PlanningEvents`、`PlanningGoalOccurrences` |
| 测算详情 | 资产轨迹、逐年快照、退休收入与预算、风险分析 | `PlanningBasicDetail`（含 `RetireOverview`、`RiskLab`） |
| 试算 | 心愿对目标的影响、职业变化、资金续航 | `PlanningWishes`、`PlanningCareerCard`、`RunwayCard` |

划分规则：**目标 = 已保存、计入结论；试算 = 临时、关闭即丢弃、不改保存的目标。** 大额计划计入目标，所以留在“目标”；心愿只比较影响、不自动并入，所以移到“试算”。

### 4.2 状态与跳转

- `PlanningBasicGoals` 中的 `detail: boolean` 改为 `view: 'goals' | 'detail' | 'trial'`，`onDetailChange` 相应改为上报当前视图；`main.tsx` 的 `planningDetail` 改为同一视图值，面包屑与标题显示“目标／测算详情／试算”。
- 移除 `planning-goal/Overview.tsx` 中的“查看计算详情与图表”主按钮（`#plan-detail-entry`）以及“更多工具与试算”卡片（`planning-more-tools`）；`GoalOverview` 不再接收 `purchasePlans` 中的心愿部分，只保留 `PlanningEvents`。
- 规划尚未设置（无 `saved.profile.retire.basic`）时，“测算详情”禁用并以 `title` 说明“完成目标设置后可查看”；“试算”中资金续航按现有能力独立可用，职业试算与心愿影响显示现有的待补齐提示。
- 有待确认回执、编辑中、设置对话框或报告打开时，标签切换与现有页面切换使用相同的阻断规则与提示。
- 以下入口必须落到正确标签并保留原有聚焦行为：`gotoPlanning('goals', focus)`、`goEvents(eventId)`（切到“目标”后滚动到大额计划）、`annotationAction` / `action` 中各类修正入口、总览规划摘要“查看目标”、财务复盘到目标的入口、来源返回上下文。
- `PlanningTab`（`'goals' | 'savings'`）保持原义：`savings` 仍转去财务复盘，不与新视图混用。
- 视图不持久化；重新进入规划默认“目标”。切库、恢复、关闭规划模块时回到“目标”。

### 4.3 验收

- 三个标签用键盘可达，`aria-pressed` 正确，切换后焦点落到页面标题。
- 原目标页上全部能力仍可访问：每个旧按钮都能在三标签中找到对应位置。
- 从标注“去核对”、大额计划编辑、总览摘要跳入时落到“目标”并定位到原控件。
- 未设置、已设置、未来投入未知、读取失败、回执待确认五种状态截图。

## 5. 首次使用

### 5.1 起步选择

当前正式库未开始（`!demoStatus.active && !demoStatus.started`）时，`demo-banner` 显示“我的资料 · 从任意模块开始记录”。本轮在该状态下，于总览页面顶部（横幅之下）显示一张起步卡片：

> **你想先做哪件事？** 只做其中一件也完全可以，另一件随时再开始。
>
> [先整理物品] [先盘点账户]
>
> ☑ 先隐藏周期费用和虚拟资产（可在设置 › 功能模块中打开）
>
> 跳过

- “先整理物品”：总览视图设为 `physical`（写 `thingary.overview-view.v1`），打开新增物品表单。
- “先盘点账户”：总览视图设为 `combined`，进入“账户与盘点”空白页（见 5.2）。
- 复选框默认勾选；勾选时通过现有 `modules_set` 写入 `recurring: false, virtual: false`，其余模块保持当前值，`incomes`／`movements` 原样传回。写入失败显示错误并保留卡片，不影响主操作继续。
- “跳过”只隐藏卡片，不改任何设置。卡片的已关闭状态存 `localStorage`（键 `thingary.start-choice.v1`，按资料库 generation 区分），本机存储读写异常时，本次会话内仍按选择隐藏卡片，只是下次启动可能再次出现。旧的总览空白起步卡片在本卡片显示期间隐藏，避免重复询问。
- 保存第一条资料（`started` 变为 true）后卡片不再出现。
- 样例模式下不显示该卡片。

### 5.2 盘点空白页

“账户与盘点”无账户时，主操作顺序为：

1. **导入已有的资产表格**：跳转到设置 › 数据管理并打开金融导入（`FinancialImportDialog`，已含模板保存）。该对话框的回执与恢复状态由 `DataManagement` 持有，不在盘点页另建一份实例。
2. 手动添加第一个账户

不新增导入格式。

### 5.3 样例横幅

样例模式横幅文字改为一行：“**样例体验** · 虚构资料，改动不影响你的资料”，后接 `Info`，完整规则（不发送通知、样例不接受新增物品等原文）放入 `Info` 文案。按钮不变。

### 5.4 验收

- 新库首次进入：卡片出现；两条路径各自到达正确页面；复选框勾选与否分别得到正确的模块状态，并在原生应用重启后保持。
- 已开始的库、样例模式、偏好文件缺失的旧库：卡片不出现，模块不被改动。
- 写入模块失败时的错误展示；`localStorage` 不可用时的降级。

## 6. 新增物品表单

### 6.1 首屏字段

新增与编辑表单 `AssetEditor` 首屏只保留：图标／照片、物品名称、购买价格、购买日期、备注与照片条。

以下内容移入一个 `details.more-fields`，摘要为“**补充更多**  分类、标签、渠道、成本、保障、品牌型号”：

- 分类、标签、购买渠道
- `AssetOptionsFields` 的成本计算模式、目标设定、保障时间与提醒
- 原“更多资料”的品牌、型号、序列号（与之合并，不再单独一个折叠）

规则：

- 编辑已有物品时，若上述任一字段已有值，折叠默认展开。
- 校验错误位于折叠内时，自动展开并聚焦首个错误字段。
- 心愿转购入（`conversion`）沿用同一布局。
- 不改变保存载荷、字段名与校验规则。

### 6.2 购买日期默认留空

`src/main.tsx` 新建物品时 `date: localDay()` 改为 `date: ''`。**心愿转购入保留默认今天**（购入正在发生）。

- 留空保存即日期未知，沿用现有“待补充”表达，日均成本不计算。
- 日期控件 `DateInput yearIntent="past"` 不变；在日期字段提示中写“留空为未知”，与价格字段提示一致。
- 草稿脏检查以初始值为基准，不因默认值变化误判。

### 6.3 验收

- 只填名称即可保存，首屏不出现分类、成本、保障等控件。
- 已有保障／成本设置的物品编辑时折叠自动展开。
- 新建默认日期为空；心愿转购入默认今天。

## 7. 购买相关概念统一

| 概念 | 定义 | 位置 |
|---|---|---|
| 心愿 | 想买、还没决定；可比较对目标的影响，不计入目标 | 心愿清单；规划“试算”中的“心愿对目标的影响” |
| 大额计划 | 已决定、计入目标的未来支出（换车、装修等） | 规划“目标” |

- `PlanningWishes` 中“大额购买计划”等标题改为“心愿对目标的影响”，说明一句“只比较影响，不计入目标；决定后可加入大额计划”。
- 其余用户可见文案中“大额计划”保持不变。实施时检查 `plan-wishes.ts`、`plan-events.ts`、`planning-goal/Overview.tsx`、`PlanningEvents.tsx`、`RetireOverview.tsx`、`PlanningRunway.tsx`、`plan-summary.ts`、`planning-first-run.ts` 中的用户可见字符串，凡把心愿称作“大额…计划”的一律改为“心愿”。
- 本轮不新增“心愿转为大额计划”的写入能力；若已有关联来源，按现有来源展示。

## 8. 报告结论旁的限制

`src/planning-report/PlanningReport.tsx` 结论卡片（`pr-conclusion`）在 `pr-headline` 之后、下一步之前，当 `impactItems.length > 0` 时增加一行：

> 另有 N 项事项会影响这个结论，见下方“影响结论的事项”。

使用现有警示样式（与 `pr-impact` 同色系），隐私模式下不显示具体项目文字，只显示数量。无影响项时不显示。

## 9. 说明与术语

### 9.1 合并声明

- `CoverageNote` 紧凑模式文案：
  - 有可核对项：“有 N 项条件待确认，详见目标页”（N = `actionableAnnotations(rows).length`）
  - 仅未计入说明：“有安排未计入，详见目标页”
- 总览规划卡片（`ReviewPlanSummary.tsx`、`plan-summary.ts`）中同时出现的“按当前假设估算”、覆盖提示等，合并为标题旁一个 `Info` 加一行上述紧凑提示；数值旁不再重复声明。

### 9.2 术语替换（仅用户可见文案）

| 现在 | 改为 | 涉及文件 |
|---|---|---|
| 计入范围 | 参与比较的账户 | `WealthChanges.tsx`、`review.ts`、`review-observations.ts`、`WealthPage.tsx`、`FinanceReviewPage.tsx`、`ReviewView.tsx`、`plan-summary.ts` |
| 受限资金 | 暂时取不出的钱 | `PlanningFunds.tsx`、`plan-basic-validation.ts`、`plan-basic.ts`、`planning-report/current-adapter.ts`、`planning-report/PlanningReport.tsx`、`planning-report/model.ts` |
| 安排发生核对 | 这笔计划实际发生了吗 | `PlanningGoalOccurrences.tsx` |
| 带待核对假设，详见目标页 | 见 9.1 | `CoverageNote.tsx` |
| 按当前假设估算 | 估算 | `ReviewPlanSummary.tsx`、`plan-summary.ts` |

- 首次出现“暂时取不出的钱”的位置附一句括注“公积金、个人养老金等”。
- 句子按语境调整语序，保持通顺；不改变含义、条件与数值。
- 测试中断言旧文案的地方同步更新。

## 10. 视觉小问题

| 问题 | 处理 |
|---|---|
| 职业试算复选框焦点框压住文字 | `src/career-preview/guided.tsx` 中 `check-line` 无样式，改用 `career-check`（`display:flex; gap:8px; align-items:center`） |
| 目标页出现“← 返回物品统计” | 复现后定位 `returnContext` 来源：若为从统计页合法跳入则保留；若为陈旧上下文，在对应跳转处按 `rememberOrigin` 规则清除。结论记入提交说明 |

## 11. README

- 首屏标语改为第 1 节定位句；副段说明两条起点与规划回答层。
- 主图仍为总览；新增一段不超过 30 秒、使用虚构资料的 GIF（打开 → 盘点 → 目标结论），来源登记在 [截图清单](images/README.md)。
- “资料与隐私”上移到功能表之前，首句为“资料只在你的电脑上：没有账号、没有网络请求、代码公开可查”。
- 功能表按“物品档案／账户盘点／规划”三组重排，辅助模块单列一行。

## 12. 文档同步

每项实施完成后同步：

| 文档 | 内容 |
|---|---|
| [PRODUCT_RULES](PRODUCT_RULES.md) | “导航仅保留目标”改为目标单入口三标签；“大额计划与心愿购买试算在目标页中部常驻”改为大额计划在“目标”、心愿影响在“试算”；新建物品日期默认留空；首次使用选择与模块写入规则 |
| [USER_GUIDE](USER_GUIDE.md) | 侧栏、物品状态切换、新增物品表单、规划三标签、首次使用、术语 |
| [VISUAL_SYSTEM_DESIGN](VISUAL_SYSTEM_DESIGN.md) | 侧栏结构、状态分段与规划标签复用 `ui-seg`、表单“补充更多”折叠 |
| [README](../README.md) | 第 11 节 |
| [images/README](images/README.md) 与 `docs/images/` | 重拍总览、物品列表、新增物品、目标三标签、首次使用卡片 |
| [CHANGELOG](../CHANGELOG.md) | 用户可感知变化 |
| [INDEX](INDEX.md) | 本文状态改为“已实施”，并更新“已批准设计与当前阶段”中关于导航的描述 |

其他规划设计文档属历史背景，仅当现行规则引用到被改动的导航描述时修正引用。

## 13. 测试

- 更新：`tests/planning-basic-ui.test.mjs`、`tests/planning-basic-consumers-integration.test.mjs`、`tests/career-card.test.mjs`、`tests/lifecycle.test.mjs`、`tests/warranty.test.mjs`、`tests/batch.test.mjs`、`tests/trash.test.mjs` 中涉及状态导航、规划布局与旧文案的断言。
- 新增（`node --test`）：
  - 物品标题推导：`filter` × `warranty` 组合 → 标题与分段选中（含资料筛选时无选中）。
  - 规划视图：各跳转入口 → 目标视图与聚焦目标。
  - 首次使用：选择结果 → 模块写入载荷（只改 `recurring`、`virtual`）。
  - 新建物品默认日期为空、心愿转购入为今天。
- Rust 测试预期不受影响；若有失败，说明不变量被破坏，先回查改动。
- 全部通过：`npm run build`、`npm run test:ui`、`npm run check`、`npm test`。

## 14. 实施顺序与提交

每步一次提交，提交只含该步相关文件，并同步该步对应的现行文档：

1. 物品导航收拢（第 3 节）
2. 规划页内标签（第 4 节，含第 7 节的标题改名）
3. 新增物品表单与日期（第 6 节）
4. 首次使用与样例横幅（第 5 节）
5. 报告限制、声明合并与术语（第 8、9 节）
6. 视觉小问题（第 10 节）
7. README、截图与 CHANGELOG（第 11、12 节剩余部分）

第 1、2 步文件基本不重叠，可并行；第 5 步依赖第 2 步的规划布局。

## 15. 实施约束

- 开始前检查分支、完整 HEAD 与工作树，保留他人改动与未跟踪文件；基线与本文不同时先核对受影响位置。
- 只用 `local.thingary.preview`、临时目录与虚构资料验证；不得打开或写入 `local.thingary.main`。
- 浏览器预览不代表原生已验：第 4 节跳转、第 5 节模块写入与重启保持、第 6 节保存须在原生开发预览中确认；未验项在提交说明中明确列出。
- 不修改根目录 `.gitignore`；不推送、不发布、不改版本号。
- 遇到与本文冲突的业务不变量时停下说明，不自行扩大范围。
