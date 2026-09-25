# 物志 · Possio

一个面向 macOS 的 Local-first 实物资产管理应用，记录重要物品从心愿、购买、使用、维护到退役或售出的完整生命周期。

**定位：高完成度的 Mac 桌面体验 + 个人持物档案 + 成本分析 + 本地数据。** 不做金融投资、日常记账或依赖服务器的家庭库存系统。

当前已完成 CP1 基本资产流程：新增 → 浏览/详情 → 更正 → 删除/恢复，并接入封面、图片附件和 HEIC。T06 分类与购买渠道及综合回归已通过；T07 退役／启用与 T08 售出／纠错已实现并验收；T09 维护档案已完成本轮实现、自动检查及隔离原生新增／同记录更正／重开证据，两轮 review 问题及原生选图问题已修复，图片／日期／写锁恢复补验完成，已达到 T09 阶段出口。此前按用户要求暂停 T10，现已完成原始 Demo 视觉还原、状态导航去重与八件原始样例的原生移植；范围与证据见视觉验证记录。完整 P0 未完成。中文名「物志」、英文名「Possio」为工作名，发布前再核查名称可用性。

已完成插入任务：**U01 内置素材库选择**。已由 Z code 按交接契约实现并本地提交，含 2026-09-25 用户中途调整：侧栏新增“素材库”页面（可上传/删除自定义素材，schema 9 持久化），新增/编辑表单“封面与图片”区平铺素材小图、点击即选。自动检查、浏览器及隔离原生证据见 [U01 记录](docs/verification/U01_MATERIAL_LIBRARY_RESULT.md)；三项 Codex review P2 已修复，剩余原生上传／草稿／删除保留引用验收已补齐，达到 U01 阶段出口。已按用户授权本地合并到主项目，集成复核已通过，下一阶段可进入 T10。

## 当前工作位置与本地集成

2026-09-25 已将 `codex/t06b-taxonomy-storage` 的 `7e6c6e5` 快进合并到 `main`（原 main 为 `3b46442`）。**后续主入口为 `/Users/jackzhu/Code/Own/Possio`**，原 `outputs/Possio-t06b` 工作树保留，不再作为默认开发目录。用户选择只做本地合并：未配置远程、未推送或发布。

合并后在主目录重新执行并通过：前端 45 项、Rust 58 项、Demo 2 项、fmt/Clippy、前端构建，以及隔离原生 App 构建。通过完整 App 路径启动并核对进程确实来自主目录，既有 13 件虚构资产正常加载，见 [启动状态](docs/verification/u01-native-completion/main-launch.txt)／[截图](docs/verification/u01-native-completion/main-launch.png)。本次只更新代码位置，仍使用 `local.possio.t06b.preview` 的原隔离资料库；未搬移或导入用户数据。用户原有未跟踪 `.gitignore` 原样保留。T09/U01 已完成阶段出口，其后 T10 的最新状态见下文，完整 P0 仍未完成。

主目录复现隔离构建：`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`。本机 `.local/t06b.conf.json` 已沿用原隔离标识，配置与构建产物不入版本库。

上一阶段：**T10 review 修复及原生补验完成，已按用户授权本地合并 main**。修复保留草稿后无法退出、保障附件 ID 跨实体混用两项问题；代码提交 `2b74e1f` 后前端 57 项、Rust 69 项、Demo 2 项及检查／构建通过。原生多份保障新增／同 ID 更正、日期校验、HEIC 草稿恢复／缺图修复／重启与写锁恢复已补验，见 [T10 记录第 10 节](docs/verification/T10_WARRANTY_RESULT.md#10-codex-review-修复与本地集成2026-09-25)。后续又补齐原生 800×600 与提交后响应丢失／崩溃重启核对，见 [第 11 节](docs/verification/T10_WARRANTY_RESULT.md#11-cp2-原生缺口补验2026-09-25)；CP2/P0 状态仍以实施计划为准。

最近完成 **T11 统一最近删除与 CP2 补验**：Z code 首轮实现后由 Codex 接续 review、修复与验收，最终代码修复提交 `57b1207` 已快进合并到本地 `main`。资产、维护和保障的统一软删除／恢复、四类筛选、原生父子独立恢复、保障删/恢复及重启持久性已通过；原生 800×600、真实写锁失败后重试，以及恢复操作提交后回包丢失／崩溃重启按原请求核对也已补齐。临时注入源码已撤除，正常隔离包重建并复核。**CP2 达到阶段出口，完整 P0 尚未完成**；执行边界见 [T11 交接](docs/handoffs/T11_UNIFIED_TRASH_ZCODE.md)，实际结果见 [T11 记录](docs/verification/T11_UNIFIED_TRASH_RESULT.md)。尚未配置远程或推送。

## 项目文档

- [产品设计](docs/PRODUCT_DESIGN.md)：产品边界、页面与交互、生命周期、计算口径、数据模型、技术原则、P0/P1/P2 和验收标准。
- [UI 方向与原型](docs/UI_DESIGN.md)：已选 A「静序」作为后续基线，B 保留为历史比较；涵盖资产浏览、快速新增和完整档案；[直接打开交互原型](docs/ui/prototype.html)。
- [实际页面视觉验证](docs/verification/VISUAL_ALIGNMENT.md)：Demo 还原的当前结论、浏览器／原生截图及明确保留的业务差异；旧“对齐”记录标为历史。
- [T09 维护档案](docs/verification/T09_MAINTENANCE_RESULT.md)：schema 8、维护新增／更正、费用与日期约束、自动检查及隔离原生证据；两轮 review 问题及原生选图问题已修复，图片／日期／写锁恢复补验完成，已达到 T09 阶段出口。
- [T10 保障档案](docs/verification/T10_WARRANTY_RESULT.md)：schema 10、多份保障独立新增／同 ID 更正、查询时派生状态（含 0/30/31 天边界与未知日期不推断）、资产保障筛选交集、备份恢复覆盖与浏览器证据；review 修复与原生核心补验完成，剩余证据边界见第 10 节。
- [Z code 交接：T11 统一最近删除](docs/handoffs/T11_UNIFIED_TRASH_ZCODE.md)：父子独立软删除/恢复、费用和附件关系、统一筛选、错误恢复及原生验收的唯一执行契约，含可直接复制的 Prompt。
- [T11 统一最近删除验证记录](docs/verification/T11_UNIFIED_TRASH_RESULT.md)：Z code 首轮与 Codex 接续修复、自动检查、隔离原生证据及未验边界。
- [T08 售出与纠错](docs/verification/T08_SALES_RESULT.md)：schema 7、结算、更正、事务与原生验收；原生撤销与重开通过。
- [T07 退役与重新启用](docs/verification/T07_LIFECYCLE_RESULT.md)：schema 6、日期顺序、失败恢复及原生重开证据。
- [T06c 综合回归](docs/verification/T06C_REGRESSION_RESULT.md)：必要修复、原生与自动验证证据、集成结论及后续边界。
- [分类与渠道接入验证](docs/verification/T06B_STORAGE_RESULT.md)：schema 5、引用事务、真实窗口保存与重启证据，以及下一轮回归边界。
- [P0 功能规格](docs/FUNCTIONAL_SPEC.md)：八条核心流程、输入与失败契约、44 条验收定义、已收敛的业务边界及补充样例。
- [技术设计与验证计划](docs/decisions/001-local-desktop.md)：本地桌面架构、数据与图片一致性、统一最近删除、备份恢复协议和七项风险验证计划；已作为任务拆分基线，底层实验与未验项见验证报告。
- [实施任务与开工检查](docs/IMPLEMENTATION_PLAN.md)：V00–V05 首批验证、T01–T21 后续任务、依赖顺序、44 条验收归属和阶段出口；任务状态唯一入口。
- [Z code 交接：U01 素材库](docs/handoffs/U01_MATERIAL_LIBRARY_ZCODE.md)：唯一执行入口，含范围、代码上下文、验收和可复制 Prompt；使用 GLM5.3 串行实现，完成后交回 Codex review。
- [U01 素材库验证记录](docs/verification/U01_MATERIAL_LIBRARY_RESULT.md)：内置素材清单与受控准备命令、表单素材网格、持久化/失败恢复测试及浏览器、原生证据；待 Codex review。
- [Hermes 交接：T09](docs/handoffs/T09_HERMES.md)：维护档案的执行位置、前审约束、验证要求及交回 Codex review 格式；实现已完成，保留为审阅契约。
- [Hermes 首次交接：T06a](docs/handoffs/T06A_HERMES.md)：分类/渠道界面的独立执行契约、允许文件、输入输出和完工报告要求；真实数据接入由 Codex 后续完成。
- [工程与流程验证报告](docs/VERIFICATION_REPORT.md)：实际环境、测试与进程中断证据、构建结果和未完成项。
- [竞品调研](docs/COMPETITOR_RESEARCH.md)：优先研究持物 iThings、有数两个直接竞品，结合八个开源候选，比较业务重合、平台体验、公开热度与差异化假设。

先读产品设计了解要做什么，再读竞品调研了解已有方案与选择理由。产品需求以产品设计为准；竞品事实以调研文档注明的来源和核验日期为准。技术方案与验证计划独立维护在 ADR-001，任务、分工与开工检查集中在实施计划，不混入产品需求和竞品事实。


## 开工准备进度

V00–V05 已执行；用户已授权进入下一阶段，T01–T05 基本流程已实现并实测，详细状态统一见实施计划。已建立本地版本管理和 [AGENTS.md](AGENTS.md)；产品决策集中维护在 [产品设计第 15.2 节](docs/PRODUCT_DESIGN.md#152-产品决策表)，不另建重复决策文档。

| 步骤 | 产物与完成标准 | 状态 |
|---|---|---|
| 0. 项目规则与版本管理 | 简版 Agent 规则、本地文档基线 | 已完成 |
| 1. 首版范围与业务规则 | D01–D12 已确认，正文与验收样例已同步 | 已完成 |
| 2. 核心流程 | 产品设计第 16 节的八条流程与 Spec 对齐，覆盖输入、失败与恢复 | 文档已细化；首段资产交互已有实测 |
| 3. UI 风格与原型 | A「静序」已由用户选定，原型覆盖列表/摘要、新增、完整详情及深浅色 | 方向已确认；细部及视觉验收待补 |
| 4. 可执行 Spec | P0 功能规格 v0.2：关键边界已确认，八条流程、44 条验收及边界样例 | 业务规格已收敛；部分 AC 有证据，完整验收待后续 |
| 5. 技术设计与风险验证计划 | ADR-001 已覆盖架构、数据/附件、恢复与测试边界，并列出 R01–R07 | 底层实验、HEIC 与基础原生交互已验；完整 Mac 体验仍待验 |
| 6. 任务拆分与分工 | V00–V05、T01–T21 已按依赖拆分；44 条 AC 已分配，Codex 串行主线 | 计划已完成；T01–T07 已达到各自已实现范围出口，T08 已达到已实现范围出口；T09 已达到本阶段出口；已本地合并 main |
| 7. 开工检查 | 文档一致性检查已完成；技术未知分配至验证任务，首次实际实施范围明确 | CP1 基本流程出口已达到；完整 P0 仍待后续阶段 |

当前采用已有技能辅助准备，不安装第二套 Spec 框架，不启用自动后台开发。UI 偏好已确认是“精致的 Mac 工具：安静、清楚、操作顺手”；已明确选定 A，功能规格中的关键取舍已确认，原生检查工具已恢复，现已完成 CP1 的基本资产流程。静态原型只演示交互，刷新会重置样例，尚不具备真实资产保存能力。文档准备完成不代表技术风险已验证或 P0 已实现。

## 本机验证工程

- 安装锁定依赖：`npm ci`。
- 开发窗口：`npm run tauri -- dev`。
- 前端类型检查与构建：`npm run build`。
- 格式与 Rust 检查：`npm run check`。
- 表单与金额/日期纯逻辑检查：`npm run test:ui`（不是原生 UI 自动化）。
- 数据与故障实验：`npm test`（使用独立临时目录；会终止自己创建的测试子进程）。
- 本机 App 打包：`npm run tauri -- build --bundles app`。

普通预览打包默认产物位于 `src-tauri/target/release/bundle/macos/Possio Preview.app`，不能将旧产物当成最新构建。本阶段使用下文 T06b 隔离验收包。不含远程更新或后台代理；只有本地提交，没有推送发布。只在当前 Apple Silicon Mac 验证，旧系统及 Intel 尚未实测。

开发预览标识为 `local.possio.preview`，资料位于 `~/Library/Application Support/local.possio.preview/library`，与旧验证 App 的临时库分开。当前可自行填写名称、金额、日期、品牌、型号、分类、购买渠道、序列号和备注，列表/网格搜索及更正后保留记录；封面与图片默认从素材小图直选，侧栏“素材库”可管理内置示意图与自定义素材；仍先使用虚构资料体验。设置和侧栏均可进入最近删除，支持资产恢复；支持 JPEG/PNG/HEIC/WebP 封面与附件、预览和缺图修复；完整备份及导出界面按后续任务接入，尚未达到 CP4 的日常自用标准。

### 完整页面的虚构数据预览

在当前分支运行 `npm run dev -- --port 1429`，打开 <http://127.0.0.1:1429/visual-preview.html>。可体验与 App 相同的列表/网格、摘要、详情、新增、更正、删除/恢复和分类/渠道、退役/重新启用及动作日期更正 UI；使用内存虚构数据，刷新即重置，不能用于保存真实档案。内置素材选择可在预览中以内存模拟体验，不能证明原生持久性；导入自己的图片仍需原生 App。

附加 `?state=empty`、`?state=error`、`?state=save-error` 可检查空白、读取失败和保存失败；`?theme=dark` 可对照深色。这个开发入口不包含在 `npm run build` 的正式产物中。原始设计比较仍在 `docs/ui/prototype.html`，两者职责不同。原型原创 SVG 由预览与原生 App 共享；原生有照片时显示照片，没有照片封面时显示分类示意图，不写入附件。`?no-photos` 用于检查六种分类插图。布局按原始 A 还原，验收库的样例数量不同不能作为改变设计的理由。

T06b 隔离验收包位于 `src-tauri/target/debug/bundle/macos/Possio T06b Preview.app`，标识 `local.possio.t06b.preview`，使用独立虚构资料库。该包当前由 T11 分支代码构建（本地窗口标题仍为 T08，保留原包名），标识与虚构库保持不变。后续以主目录本地 `main` 为集成入口；浏览器预览刷新重置，原生验收包才会实际持久保存。


### 原生 Demo 样例

隔离验收 App 现已持久保存原始八件 Demo（电脑、相机、耳机、手机、平板、键盘、咖啡机、录音设备），每件使用自己的原创插图封面，可直接编辑体验。原有两件验收记录保留；搜索“原始 Demo”可只查看这八件。状态入口只在左侧，中间不再重复显示同一组标签。

样例与浏览器共用 `src/demo-assets.json`；PNG 来自既有 `src/illustrations.ts` 的 SVG 转换，现随内置素材库位于 `src-tauri/materials/`（清单 `materials.json` 加同名 PNG），不是重新生成的图；Demo 导入与素材准备共用同一白名单。维护、退役、售出使用已实现的业务接口，保障等未实现字段不导入。

开发复现：退出隔离 App 后，在本工作树执行 `npm run demo:import`。工具只允许现有 `local.possio.t06b.preview` 虚构库，拒绝其他路径及符号链接；重复执行不重复添加、不覆盖完成导入后的编辑。每件及其后续动作各自使用稳定请求 ID，可从中断步骤续行；未完成步骤若遇到版本变化会拒绝，不能把它用作一键重置。普通 App 启动不会导入 Demo。

`npm run test:demo` 验证导入、图片、重开、重复执行保留编辑和目标路径限制。PNG 转换的可选开发命令是 `node scripts/render-demo-art.mjs <已有 sharp 模块的绝对入口>`；导入使用已提交的 PNG，无需安装图片转换依赖。
