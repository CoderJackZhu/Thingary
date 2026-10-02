# 文档索引与项目状态

> 本文件是原 README 的内部导览（当前状态、文档入口、开发命令）。面向用户的介绍见仓库根目录的 [README](../README.md)。

物谱 Thingary——Your things, over time。一个面向 macOS 的 Local-first 个人物品与家底记录应用（中文副标题：物品档案与家底回顾；工程内部名 Possio）：记录值得记住的物品，看清自己的家底如何随时间变化。核心是大件物品的档案与金融净资产；重要支出、周期费用、虚拟资产为可开关的辅助模块（产品设计 D22；2.0.0–2.3.0 曾称「家底」，2.3.1 曾短暂改回「物志」；因重名与商标冲突，2.3.2 起为「物谱」，见 D26）。

**当前定位：高完成度的 Mac 桌面体验 + 个人持物档案 + 低频财富回顾 + 本地数据。** 不做日常记账，不依赖服务器。统一产品需求见产品设计第 17 节；其中 A · 财富盘点随 1.2.0、B · 重要支出随 1.3.0、C1 · 周期费用随 1.4.0、C2 · 虚拟资产随 1.8.0、D · 综合体验随 1.9.0 发布。

## 当前状态（2026-10-01）

- 自用正式版 **2.4.3**（中文名「物谱」英文名 Thingary，含新应用图标、统计页「售出保值率」U19、负金额格式修复、CSV 导入出售行后备份失败的修复、明暗按钮可见性与主题切换动画）已安装在 `/Applications/物谱.app`，安装时间 2026-10-02T16:17+08:00；身份 `local.possio.main` 不变，回退副本保存在本机 `.local/install/`（2.4.2、2.4.1、2.4.0、2.3.5、2.3.4、2.3.3、2.3.2「物谱」、2.3.0「家底」等，不入库）。**正式库是真实资料，开发、测试和验收一律不得打开或写入。**
- P0 闭环、A 财富盘点、B 重要支出、C 周期费用与虚拟资产、D 综合体验及 U 系列迭代均已交付。任务状态以[实施计划](IMPLEMENTATION_PLAN.md)为准，逐次变更见 [CHANGELOG](../CHANGELOG.md)。
- 原生验收已补做大部分（见[原生验收补做](verification/NATIVE_ACCEPTANCE_20261001_RESULT.md)）；系统外观实时切换、VoiceOver 等需要本人操作的项目与发布前盘点结论见[发布前盘点](RELEASE_AUDIT.md)。
- 名称：中文名「物谱」、英文名 Thingary，均已由用户确认（2026-10-02，产品设计 D26）；近似商标风险由用户知情承担，官方商标网复核未做，见[竞品调研第 14.3 节](COMPETITOR_RESEARCH.md#143-近似名分析与官方商标网复核2026-10-01第二次)。许可证 GPL-3.0（见 `LICENSE`）。公开发布清单见[发布前盘点第 10 节](RELEASE_AUDIT.md)。
- 仅在 Apple Silicon Mac 验证；macOS 14 与 Intel 尚未实测。

使用前请阅读 [使用说明](USER_GUIDE.md)。

## 许可与标志

- 代码按 [GPL-3.0-or-later](../LICENSE) 授权。
- **名称「物谱」「Thingary」与应用图标（五线谱标志，见 [品牌与图标](brand/README.md)）不在 GPL 授权范围内**，使用权保留：欢迎 fork 和学习代码，但再发布修改版时请换用自己的名称与图标，避免与本项目混淆。

## 文档

**使用与产品**

- [使用说明](USER_GUIDE.md)：安装、资料位置、完整备份与恢复及当前限制。
- [产品设计](PRODUCT_DESIGN.md)：产品边界、页面与交互、生命周期、计算口径、数据模型、P0/P1/P2 与验收标准；第 15.2 节为实物决策表；[第 17 节](PRODUCT_DESIGN.md#17-统一资产扩展需求草案2026-09-28)集中维护统一资产扩展，17.12 为 A–C2 已确认规则，17.13 为 D 综合体验方案（已交付）。
- [P0 功能规格](FUNCTIONAL_SPEC.md)：八条核心流程、输入与失败契约、44 条验收定义。
- **现行界面规范**：[U16 设计规范](ui/U16_DESIGN_SPEC.md)（令牌、格式、组件、逐页规范、三主题检查表）与设计稿 v3 [`docs/ui/u16/mockup-v3.html`](ui/u16/mockup-v3.html)；接续结果、验收收口与发布记录见 [U16 验证记录](verification/U16_PARITY_RESULT.md)。
- [竞品调研](COMPETITOR_RESEARCH.md)：直接竞品与开源候选比较、差异化假设；第 9–28 节为 2026-10-01 补充的同类应用快照与功能对照、开源逐项核验（平台、成熟度、与本项目对比）、平台受众（含安卓、Windows、Linux）、付费与分发、名称核查、移植工作量评估。

**技术与计划**

- [技术设计 ADR-001](decisions/001-local-desktop.md)：本地桌面架构、数据与图片一致性、最近删除、备份恢复协议与风险验证计划。
- [实施计划](IMPLEMENTATION_PLAN.md)：任务拆分、依赖、验收归属、阶段出口；任务状态唯一入口。

**验证记录**（`docs/verification/`，每项含自动检查、隔离原生结果与未验边界；2026-10-01 起只保留报告文本，截图与机器日志已移出工作树，见该目录的 README）

- [设置与操作入口修订](verification/SETTINGS_POLISH_RESULT.md)：渠道/标签改名删除、设置分组、返回与关闭按钮；已验证，已随 1.12.1 安装。

| 阶段 | 记录 |
|---|---|
| P0 验收与发布 | [T21 完整 P0 验收](verification/T21_P0_ACCEPTANCE_RESULT.md) · [T22 自用正式版](verification/T22_SELF_USE_RELEASE_RESULT.md) |
| 资产档案 | [T06b 分类与渠道](verification/T06B_STORAGE_RESULT.md) · [T06c 综合回归](verification/T06C_REGRESSION_RESULT.md) · [T07 退役／启用](verification/T07_LIFECYCLE_RESULT.md) · [T08 售出与纠错](verification/T08_SALES_RESULT.md) · [T09 维护](verification/T09_MAINTENANCE_RESULT.md) · [T10 保障](verification/T10_WARRANTY_RESULT.md) · [T11 统一最近删除](verification/T11_UNIFIED_TRASH_RESULT.md) |
| 心愿与回顾 | [T12 心愿](verification/T12_WISHLIST_RESULT.md) · [T13 心愿转资产](verification/T13_WISHLIST_CONVERSION_RESULT.md) · [T14 时间轴](verification/T14_TIMELINE_RESULT.md) · [T15 总览](verification/T15_OVERVIEW_RESULT.md) · [T16 趋势](verification/T16_TRENDS_RESULT.md) · [T17 持有分析](verification/T17_HOLDING_RESULT.md) |
| 数据与 Mac 体验 | [T18 备份恢复](verification/T18_BACKUP_RESTORE_RESULT.md) · [T19 CSV 导出](verification/T19_CSV_EXPORT_RESULT.md) · [T20 Mac 操作体验](verification/T20_MAC_EXPERIENCE_RESULT.md) · [窗口与外观](verification/WINDOW_THEME_RESULT.md) · [视觉还原](verification/VISUAL_ALIGNMENT.md) |
| 迭代 | [U01 素材库](verification/U01_MATERIAL_LIBRARY_RESULT.md) · [图标选择器](verification/ICON_PICKER_RESULT.md) · [P1 首次样例与日期](verification/P1_FIRST_RUN_DEMO_DATE_RESULT.md) · [U02](verification/U02_ASSET_WISHLIST_RESULT.md) · [U03](verification/U03_DESKTOP_INTERACTION_RESULT.md) · [U04](verification/U04_WISH_TIMELINE_REMINDER_RESULT.md) · [U05](verification/U05_WISH_ASSET_SETTINGS_STATS_RESULT.md) · [U06](verification/U06_SETTINGS_ALIGNMENT_RESULT.md) · [U07](verification/U07_DESKTOP_POLISH_RESULT.md) · [U08](verification/U08_ASSET_EDITOR_USABILITY_RESULT.md) |
| 财富盘点 | [W03 删除恢复、备份与原生验收](verification/W03_WEALTH_RESULT.md)；设计见 ADR-001 第 17 节 |
| 重要支出 | [E03 删除恢复、时间轴与原生验收](verification/E03_EXPENSES_RESULT.md)；设计见 ADR-001 第 18 节 |
| 周期费用 | [R03 删除恢复、时间轴与原生验收](verification/R03_RECURRING_RESULT.md)；设计见 ADR-001 第 19 节 |
| 综合体验 D | [Q02 综合回顾](verification/Q02_COMPREHENSIVE_RESULT.md) · [Q03 时间轴与来源跳转](verification/Q03_SOURCE_NAVIGATION_RESULT.md) · [Q04 原生验收](verification/Q04_COMPREHENSIVE_NATIVE_RESULT.md)（浏览器证据）；Q04 原生全量验收未开始 |

历史交接文档、早期 UI 方向文档与验收截图已于 2026-10-01 从工作树移出，仍可在 git 历史与本地标签 `archive/pre-cleanup-2026-10-01` 中查看。协作规则见 [AGENTS.md](../AGENTS.md)。

产品需求以产品设计为准，竞品事实以调研文档注明的来源和核验日期为准；技术方案独立维护在 ADR-001，任务与分工集中在实施计划，互不重复抄录。

## 开发

- 安装锁定依赖：`npm ci`。
- 开发窗口：`npm run tauri -- dev`。
- 前端类型检查与构建：`npm run build`。
- 格式与 Rust 检查：`npm run check`。
- 表单与金额／日期纯逻辑检查：`npm run test:ui`（不是原生 UI 自动化）。
- 数据与故障实验：`npm test`（使用独立临时目录；会终止自己创建的测试子进程）。Rust 部分链接 macOS 原生框架，只能在 Mac 上构建。
- 本机 App 打包：`npm run tauri -- build --bundles app`，产物位于 `src-tauri/target/release/bundle/macos/Thingary Preview.app`；不要把旧产物当成最新构建。
- 自用正式版打包：`npm run release`（仅覆盖正式身份；安装与验收见 T22 记录）。

开发预览标识为 `local.possio.preview`，资料位于 `~/Library/Application Support/local.possio.preview/library`，只用于虚构资料，与正式版及各隔离验收库分开。不含远程更新或后台代理。只在 Apple Silicon Mac 验证，macOS 14 与 Intel 尚未实测。

### 浏览器中的虚构数据预览

运行 `npm run dev -- --port 1429`，打开 <http://127.0.0.1:1429/visual-preview.html>。可体验与 App 相同的列表／网格、详情、新增、更正、删除／恢复、分类／渠道及生命周期 UI；使用内存虚构数据，刷新即重置，不能证明原生持久性。

附加 `?state=empty`、`?state=error`、`?state=save-error` 检查空白、读取失败和保存失败；财富页另有 `?wealth=empty`、`?wealth=first`、`?wealth=error`，重要支出页有 `?expenses=empty`、`?expenses=error`，周期费用页有 `?recurring=empty`、`?recurring=error`；`?theme=dark` 对照深色；`?no-photos` 检查六种分类插图。这个入口不包含在 `npm run build` 的产物中。原始设计比较仍在 `docs/ui/prototype.html`，两者职责不同。

### 样例数据

1.5.0 首次使用展示独立完整样例，涵盖原始八件物品及心愿生成资产、保障、账户与六期盘点、支出/退款、周期计划/付款。样例内编辑、删除仅影响样例，不接受新增资产（含心愿实现），“新增资产”会回到我的资料；先明确切到“我的资料”，首次成功记录后长期记住该状态。设置可查看或确认重置样例；删空真实记录不自动恢复样例。样例体验规则及入口见[使用说明](USER_GUIDE.md)。

实物与金融样例源分别为 `src/demo-assets.json`、`src/demo-finance.json`；浏览器预览复用基础事实但为内存模拟，不能代替原生持久性验收。封面 PNG 随内置素材库位于 `src-tauri/materials/`（清单 `materials.json`）。

`npm run demo:import` 只向隔离的 `local.possio.t06b.preview` 虚构库导入同一组样例（拒绝其他路径及符号链接，可重复执行、不覆盖编辑）；`npm run test:demo` 验证导入、图片、重开和目标路径限制。PNG 转换的可选开发命令是 `node scripts/render-demo-art.mjs <已有 sharp 模块的绝对入口>`。
