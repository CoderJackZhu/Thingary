# 物志 · Possio

一个面向 macOS 的 Local-first 个人物品与家底记录应用：记录值得记住的物品，看清自己的家底如何随时间变化。核心是大件物品的档案与金融净资产；重要支出、周期费用、虚拟资产为可开关的辅助模块（产品设计 D22；2.0.0–2.3.0 曾称「家底」，因重名由 D25 改回「物志」）。

**当前定位：高完成度的 Mac 桌面体验 + 个人持物档案 + 低频财富回顾 + 本地数据。** 不做日常记账，不依赖服务器。统一产品需求见产品设计第 17 节；其中 A · 财富盘点随 1.2.0、B · 重要支出随 1.3.0、C1 · 周期费用随 1.4.0、C2 · 虚拟资产随 1.8.0、D · 综合体验随 1.9.0 发布。

## 当前状态（2026-10-01）

- 自用正式版 **2.3.0**（含 U18 桌面布局修复与导航整理，已合并 main）当前安装在 `/Applications/家底.app`（旧名）；**2.3.1（名称恢复为「物志」，见 D25）已构建、尚未安装**，安装后为 `/Applications/物志.app`。身份 `local.possio.main` 不变，回退副本保存在本机 `.local/install/`（不入库）。**正式库是真实资料，开发、测试和验收一律不得打开或写入。**
- P0 闭环、A 财富盘点、B 重要支出、C 周期费用与虚拟资产、D 综合体验及 U 系列迭代均已交付。任务状态以[实施计划](docs/IMPLEMENTATION_PLAN.md)为准，逐次变更见 [CHANGELOG](CHANGELOG.md)。
- 原生验收仍有缺口（需真实指针、系统外观切换、辅助功能授权等）与发布前盘点结论见[发布前盘点](docs/RELEASE_AUDIT.md)。
- 名称已定为「物志」（产品设计 D25）；商标与 ICP 备案占用仍需手工核验，英文名 Possio 对外使用前须解决重名，开源许可与公开发布方式尚未决定，见[竞品调研第 14 节](docs/COMPETITOR_RESEARCH.md#14-名称核查2026-10-01国区-app-store-与美区检索)与[发布前盘点](docs/RELEASE_AUDIT.md)。
- 仅在 Apple Silicon Mac 验证；macOS 14 与 Intel 尚未实测。

使用前请阅读 [使用说明](docs/USER_GUIDE.md)。

## 文档

**使用与产品**

- [使用说明](docs/USER_GUIDE.md)：安装、资料位置、完整备份与恢复及当前限制。
- [产品设计](docs/PRODUCT_DESIGN.md)：产品边界、页面与交互、生命周期、计算口径、数据模型、P0/P1/P2 与验收标准；第 15.2 节为实物决策表；[第 17 节](docs/PRODUCT_DESIGN.md#17-统一资产扩展需求草案2026-09-28)集中维护统一资产扩展，17.12 为 A–C2 已确认规则，17.13 为 D 综合体验方案（已交付）。
- [P0 功能规格](docs/FUNCTIONAL_SPEC.md)：八条核心流程、输入与失败契约、44 条验收定义。
- **现行界面规范**：[U16 设计规范](docs/ui/U16_DESIGN_SPEC.md)（令牌、格式、组件、逐页规范、三主题检查表）与设计稿 v3 [`docs/ui/u16/mockup-v3.html`](docs/ui/u16/mockup-v3.html)；计划见 [U16 设计对齐计划](docs/ui/U16_DESIGN_PARITY_PLAN.md)，接续结果、50 组对照、验收收口与发布记录见 [U16 验证记录](docs/verification/U16_PARITY_RESULT.md)。
- [UI 方向与原型（历史）](docs/UI_DESIGN.md)：早期选定 A「静序」为基线；[交互原型](docs/ui/prototype.html)。已由 U16 规范取代，仅供追溯。
- [竞品调研](docs/COMPETITOR_RESEARCH.md)：直接竞品与开源候选比较、差异化假设；第 9–28 节为 2026-10-01 补充的同类应用快照与功能对照、开源逐项核验（平台、成熟度、与本项目对比）、平台受众（含安卓、Windows、Linux）、付费与分发、名称核查、移植工作量评估。

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
