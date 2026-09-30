# 家底 · Possio

一个面向 macOS 的 Local-first 家底记录应用：记录值得记住的物品，看清自己的家底如何随时间变化。核心是大件物品的档案与金融净资产；重要支出、周期费用、虚拟资产为可开关的辅助模块（产品设计 D22，2.0.0 起由「物志」改名）。

**当前定位：高完成度的 Mac 桌面体验 + 个人持物档案 + 低频财富回顾 + 本地数据。** 不做日常记账，不依赖服务器。统一产品需求见产品设计第 17 节；其中 A · 财富盘点随 1.2.0、B · 重要支出随 1.3.0、C1 · 周期费用随 1.4.0、C2 · 虚拟资产随 1.8.0、D · 综合体验随 1.9.0 发布。

## U18 桌面布局与导航整理（第二修订轮完成，交回独立复审，未提交/未发布）

zcode 已回交工作区实现；第一轮[独立 Review](docs/verification/U18_REVIEW_RESULT.md)要求修订 R1–R7（分类页崩溃、周期按钮挤压、21 张无效截图等）。**修订轮已完成**（R1–R7，见验证报告 §10）；**第二修订轮已完成**（复审二 P2-1 分类菜单键盘焦点以真实按键验证 8/8、P3-1 manifest 重生成 151 张实际文件全量哈希、P3-2 索引全矩阵、P3-3 窄窗残留登记、P3-4 数字更正＋reserveMore，见验证报告 §11）。原生 UI 行为仍为未验项；当前可用功能仍以已发布版本为准。

- [产品规则与验收](docs/PRODUCT_DESIGN.md#u18-product)：六项范围、非目标与 U18-AC01–12。
- [界面设计](docs/ui/U18_DESKTOP_LAYOUT_DESIGN.md)：布局、分类菜单、返回与焦点、主题、状态和同尺寸证据要求。
- [实施计划 U18](docs/IMPLEMENTATION_PLAN.md#u18)：各阶段修订状态、原生行为缺口与 Review 边界。
- [zcode 验证报告](docs/verification/U18_DESKTOP_LAYOUT_RESULT.md)：首轮记录保留，修订轮证据见 §10、第二修订轮见 §11；[视觉索引](docs/ui/desktop-layout/index.html)：before/after 全矩阵 151 张对照；[指纹清单](docs/ui/desktop-layout/revision/manifest.json)（2026-10-01 重生成）。
- [zcode 开发交接与启动 Prompt](docs/U18_ZCODE_HANDOFF.md)：接手基线、执行要求、证据格式与交回独立 Review。

## U17 标签投入分析（已随 2.2.0 发布）

从现有标签查看相关实物的购入、维护、累计投入、售出回收及每件投入占比（产品设计 D23）。2026-09-30 zcode 完成开发与修订，第二轮独立 Review（U17r）通过（含非阻断备注）；用户已授权提交、推送、安装。2.2.0 已提交、推送并安装；[发布记录](docs/verification/U17_REVIEW_RESULT.md#6-220-发布与安装2026-09-30)包含构建身份、回退包与完整校验清单。

- [产品规则与验收](docs/PRODUCT_DESIGN.md#u17-product)：范围、金额/缺失口径、虚构样例及 U17-AC。
- [界面设计](docs/ui/U17_TAG_INVESTMENT_DESIGN.md)与[视觉证据索引](docs/ui/tag-investment/index.html)：入口、布局、状态与三主题对照。
- [技术契约](docs/decisions/001-local-desktop.md#u17-technical)：只读聚合、接口冻结（25.5）与实际接线（25.6.1）。
- [实施计划 U17](docs/IMPLEMENTATION_PLAN.md#u17)：唯一任务状态、依赖、检查与交接边界。
- [独立 Review](docs/verification/U17_REVIEW_RESULT.md)：首轮发现、第二轮关闭记录、独立检查与证据边界。
- [zcode 验证报告](docs/verification/U17_TAG_INVESTMENT_RESULT.md)：命令结果、AC 证据矩阵、原生证据与残余缺口；[交接说明](docs/U17_ZCODE_HANDOFF.md)。

## 当前状态

- 1.14.0 新增默认自动备份（U13，[产品设计 D20](docs/PRODUCT_DESIGN.md#d20--默认自动备份2026-09-29-用户确认u13)）：有改动约 2 分钟后在后台备份到资料目录旁，每天一份、保留 7 份，可选额外位置；zcode 实现、Claude 复核，见 [U13 记录](docs/verification/U13_AUTO_BACKUP_RESULT.md)。
- 1.13.0 实现 U12 顶栏与页面搜索统一（zcode 按交接完成 U12a–d，Claude 复核修复并补齐证据），已提交推送并安装：页面矩阵顶栏、新增记录菜单、⌘N/⌘F 当前页分派、各页真实搜索（先搜索后分页、汇总金额不受影响、切库清空）；证据见 [U12 记录](docs/verification/U12_TOPBAR_SEARCH_RESULT.md)与[对照索引](docs/ui/topbar-search/index.html)，进度见实施计划 U12。
- P0 闭环已完成（CP1–CP4 达到出口；AC40 的 VoiceOver 等未实测项为已接受风险，见 [T21 报告](docs/verification/T21_P0_ACCEPTANCE_RESULT.md) §9）。
- 自用正式版 **2.2.0** 已安装在 `/Applications/家底.app`：U17 新增标签投入分析，保留 U16 三主题与既有功能。见 [U17 发布记录](docs/verification/U17_REVIEW_RESULT.md#6-220-发布与安装2026-09-30)。身份仍为 `local.possio.main`，2.1.0 回退副本在 `.local/install/家底-2.1.0.app`。**正式库是真实资料，开发、测试和验收一律不得打开或写入；此次安装仅替换应用包，未启动正式版。**
- 1.9.0 新增 D · 综合体验：总览分「综合回顾／实物概览」两个视图，时间轴按领域与年份筛选并含盘点事件，各事件可「查看来源」直接打开原记录；见 [Q04 原生验收](docs/verification/Q04_COMPREHENSIVE_NATIVE_RESULT.md)。
- 1.8.0 新增虚拟资产（C2）：买断软件、域名与订阅服务的档案、有效期与花费，可关联周期计划；见 [G03 记录](docs/verification/G03_VIRTUAL_RESULT.md)。
- 1.7.1 按反馈微调：删除确认按钮为实心红色、选择图标与「全选」、圆形勾选标记、侧栏「保障中」。
- 1.7.0 新增物品批量操作（D19）：多选、批量面板、逐件批量表与整批撤销，已通过隔离原生验收并安装；见 [U11 记录](docs/verification/U11_BATCH_RESULT.md)。
- 1.6.3 新增 12 个立体图标，立体素材共 16 个，已通过隔离原生验收并安装；见[验收记录](docs/verification/ICON_PICKER_RESULT.md#2026-09-28--立体图标扩充)。
- 1.6.2 图标扩充（新增 22 个大件主题）已通过隔离验收并安装；见[图标验收记录](docs/verification/ICON_PICKER_RESULT.md#2026-09-28--原生补验与-162-收尾)。
- U09 全功能统一样例已完成验收，合入 `main` 并随 1.5.0 安装，1.5.1 补充样例不接受新增资产与编辑表单删除入口（U09d）；验收见 [U09 记录](docs/verification/U09_UNIFIED_DEMO_RESULT.md)。
- U10 删除与恢复统一规则（D17/D18）已完成验收，合入 `main` 并随 1.6.0 安装，1.6.1 增加 ⌘Z 撤销删除，见 [U10 记录](docs/verification/U10_DELETION_RESULT.md)。
- 之后按用户反馈进行 U 系列迭代；逐次变更见 [CHANGELOG](CHANGELOG.md)，任务状态以[实施计划](docs/IMPLEMENTATION_PLAN.md)为准。
- 中文名「物志」、英文名「Possio」用于自用构建；公开发布前仍需核查名称可用性。

使用前请阅读 [物志使用说明](docs/USER_GUIDE.md)。

## 文档

**使用与产品**

- [物志使用说明](docs/USER_GUIDE.md)：安装、资料位置、完整备份与恢复及当前限制。
- [产品设计](docs/PRODUCT_DESIGN.md)：产品边界、页面与交互、生命周期、计算口径、数据模型、P0/P1/P2 与验收标准；第 15.2 节为实物决策表；[第 17 节](docs/PRODUCT_DESIGN.md#17-统一资产扩展需求草案2026-09-28)集中维护统一资产扩展，17.12 为 A–C2 已确认规则，17.13 为 D 综合体验方案（已交付）。
- [P0 功能规格](docs/FUNCTIONAL_SPEC.md)：八条核心流程、输入与失败契约、44 条验收定义。
- **现行界面规范**：[U16 设计规范](docs/ui/U16_DESIGN_SPEC.md)（令牌、格式、组件、逐页规范、三主题检查表）与设计稿 v3 [`docs/ui/u16/mockup-v3.html`](docs/ui/u16/mockup-v3.html)；计划见 [U16 设计对齐计划](docs/ui/U16_DESIGN_PARITY_PLAN.md)，接续结果、50 组对照、验收收口与发布记录见 [U16 验证记录](docs/verification/U16_PARITY_RESULT.md)。
- [UI 方向与原型（历史）](docs/UI_DESIGN.md)：早期选定 A「静序」为基线；[交互原型](docs/ui/prototype.html)。已由 U16 规范取代，仅供追溯。
- [竞品调研](docs/COMPETITOR_RESEARCH.md)：直接竞品与开源候选比较、差异化假设。

**技术与计划**

- [技术设计 ADR-001](docs/decisions/001-local-desktop.md)：本地桌面架构、数据与图片一致性、最近删除、备份恢复协议与风险验证计划。
- [实施计划](docs/IMPLEMENTATION_PLAN.md)：任务拆分、依赖、验收归属、阶段出口；任务状态唯一入口。
- [工程与流程验证报告](docs/VERIFICATION_REPORT.md)：底层实验、进程中断证据与构建结果。

**验证记录**（`docs/verification/`，每项含自动检查、隔离原生证据与未验边界）

- [设置与操作入口修订](docs/verification/SETTINGS_POLISH_RESULT.md)：渠道/标签改名删除、设置分组、返回与关闭按钮；已验证，已随 1.12.1 安装。

| 阶段 | 记录 |
|---|---|
| P0 验收与发布 | [T21 完整 P0 验收](docs/verification/T21_P0_ACCEPTANCE_RESULT.md) · [T22 自用正式版](docs/verification/T22_SELF_USE_RELEASE_RESULT.md) |
| 资产档案 | [T06b 分类与渠道](docs/verification/T06B_STORAGE_RESULT.md) · [T06c 综合回归](docs/verification/T06C_REGRESSION_RESULT.md) · [T07 退役／启用](docs/verification/T07_LIFECYCLE_RESULT.md) · [T08 售出与纠错](docs/verification/T08_SALES_RESULT.md) · [T09 维护](docs/verification/T09_MAINTENANCE_RESULT.md) · [T10 保障](docs/verification/T10_WARRANTY_RESULT.md) · [T11 统一最近删除](docs/verification/T11_UNIFIED_TRASH_RESULT.md) |
| 心愿与回顾 | [T12 心愿](docs/verification/T12_WISHLIST_RESULT.md) · [T13 心愿转资产](docs/verification/T13_WISHLIST_CONVERSION_RESULT.md) · [T14 时间轴](docs/verification/T14_TIMELINE_RESULT.md) · [T15 总览](docs/verification/T15_OVERVIEW_RESULT.md) · [T16 趋势](docs/verification/T16_TRENDS_RESULT.md) · [T17 持有分析](docs/verification/T17_HOLDING_RESULT.md) |
| 数据与 Mac 体验 | [T18 备份恢复](docs/verification/T18_BACKUP_RESTORE_RESULT.md) · [T19 CSV 导出](docs/verification/T19_CSV_EXPORT_RESULT.md) · [T20 Mac 操作体验](docs/verification/T20_MAC_EXPERIENCE_RESULT.md) · [窗口与外观](docs/verification/WINDOW_THEME_RESULT.md) · [视觉还原](docs/verification/VISUAL_ALIGNMENT.md) |
| 迭代 | [U01 素材库](docs/verification/U01_MATERIAL_LIBRARY_RESULT.md) · [图标选择器](docs/verification/ICON_PICKER_RESULT.md) · [P1 首次样例与日期](docs/verification/P1_FIRST_RUN_DEMO_DATE_RESULT.md) · [U02](docs/verification/U02_ASSET_WISHLIST_RESULT.md) · [U03](docs/verification/U03_DESKTOP_INTERACTION_RESULT.md) · [U04](docs/verification/U04_WISH_TIMELINE_REMINDER_RESULT.md) · [U05](docs/verification/U05_WISH_ASSET_SETTINGS_STATS_RESULT.md) · [U06](docs/verification/U06_SETTINGS_ALIGNMENT_RESULT.md) · [U07](docs/verification/U07_DESKTOP_POLISH_RESULT.md) · [U08](docs/verification/U08_ASSET_EDITOR_USABILITY_RESULT.md) |
| 财富盘点 | [W03 删除恢复、备份与原生验收](docs/verification/W03_WEALTH_RESULT.md)；设计见 ADR-001 第 17 节 |
| 重要支出 | [E03 删除恢复、时间轴与原生验收](docs/verification/E03_EXPENSES_RESULT.md)；设计见 ADR-001 第 18 节 |
| 周期费用 | [R03 删除恢复、时间轴与原生验收](docs/verification/R03_RECURRING_RESULT.md)；设计见 ADR-001 第 19 节 |
| 综合体验 D | [Q02 综合回顾](docs/verification/Q02_COMPREHENSIVE_RESULT.md) · [Q03 时间轴与来源跳转](docs/verification/Q03_SOURCE_NAVIGATION_RESULT.md) · [Q04 原生验收](docs/verification/Q04_COMPREHENSIVE_NATIVE_RESULT.md)（[浏览器证据](docs/ui/comprehensive/q03/index.html)）；Q04 原生全量验收未开始 |

已完成任务的交接契约归档在 [docs/archive](docs/archive/README.md)。协作规则见 [AGENTS.md](AGENTS.md)。

产品需求以产品设计为准，竞品事实以调研文档注明的来源和核验日期为准；技术方案独立维护在 ADR-001，任务与分工集中在实施计划，互不重复抄录。

## 开发

- 安装锁定依赖：`npm ci`。
- 开发窗口：`npm run tauri -- dev`。
- 前端类型检查与构建：`npm run build`。
- 格式与 Rust 检查：`npm run check`。
- 表单与金额／日期纯逻辑检查：`npm run test:ui`（不是原生 UI 自动化）。
- 数据与故障实验：`npm test`（使用独立临时目录；会终止自己创建的测试子进程）。Rust 部分链接 macOS 原生框架，只能在 Mac 上构建。
- 本机 App 打包：`npm run tauri -- build --bundles app`，产物位于 `src-tauri/target/release/bundle/macos/Possio Preview.app`；不要把旧产物当成最新构建。
- 自用正式版打包：`npm run release`（仅覆盖正式身份；安装与验收见 T22 记录）。

开发预览标识为 `local.possio.preview`，资料位于 `~/Library/Application Support/local.possio.preview/library`，只用于虚构资料，与正式版及各隔离验收库分开。不含远程更新或后台代理。只在 Apple Silicon Mac 验证，macOS 14 与 Intel 尚未实测。

### 浏览器中的虚构数据预览

运行 `npm run dev -- --port 1429`，打开 <http://127.0.0.1:1429/visual-preview.html>。可体验与 App 相同的列表／网格、详情、新增、更正、删除／恢复、分类／渠道及生命周期 UI；使用内存虚构数据，刷新即重置，不能证明原生持久性。

附加 `?state=empty`、`?state=error`、`?state=save-error` 检查空白、读取失败和保存失败；财富页另有 `?wealth=empty`、`?wealth=first`、`?wealth=error`，重要支出页有 `?expenses=empty`、`?expenses=error`，周期费用页有 `?recurring=empty`、`?recurring=error`；`?theme=dark` 对照深色；`?no-photos` 检查六种分类插图。这个入口不包含在 `npm run build` 的产物中。原始设计比较仍在 `docs/ui/prototype.html`，两者职责不同。

### 样例数据

1.5.0 首次使用展示独立完整样例，涵盖原始八件物品及心愿生成资产、保障、账户与六期盘点、支出/退款、周期计划/付款。样例内编辑、删除仅影响样例，不接受新增资产（含心愿实现），“新增资产”会回到我的资料；先明确切到“我的资料”，首次成功记录后长期记住该状态。设置可查看或确认重置样例；删空真实记录不自动恢复样例。样例体验规则及入口见[使用说明](docs/USER_GUIDE.md)。

实物与金融样例源分别为 `src/demo-assets.json`、`src/demo-finance.json`；浏览器预览复用基础事实但为内存模拟，不能代替原生持久性验收。封面 PNG 随内置素材库位于 `src-tauri/materials/`（清单 `materials.json`）。

`npm run demo:import` 只向隔离的 `local.possio.t06b.preview` 虚构库导入同一组样例（拒绝其他路径及符号链接，可重复执行、不覆盖编辑）；`npm run test:demo` 验证导入、图片、重开和目标路径限制。PNG 转换的可选开发命令是 `node scripts/render-demo-art.mjs <已有 sharp 模块的绝对入口>`。
