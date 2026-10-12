# 开发与测试

本文面向贡献者。使用软件请从[使用指南](USER_GUIDE.md#download)开始；行为口径见[业务规则](PRODUCT_RULES.md)，提交与文档职责见[贡献指南](../CONTRIBUTING.md)和[文档维护](MAINTAINING.md)。本页维护当前验证入口和边界，逐轮执行日志另行归档。

## 准备环境

需要 Mac、Xcode 命令行工具、Node.js 与 npm、Rust 稳定版工具链。CI 使用 Node.js 22 与 Rust stable；使用仓库锁文件，不随意升级依赖。Rust 链接 macOS 原生框架，其他系统上的前端构建不能代替完整应用构建。

```sh
npm ci
npm run tauri -- dev
```

开发应用标题为「物谱 · 开发预览」，身份 `local.thingary.preview`。开发、测试和验收一律使用虚构资料、临时目录或独立身份，**不得打开或写入正式资料库 `local.thingary.main`**。样例库不是自己的资料，正式安装包也不是测试环境。

## 自动检查

在仓库根目录执行适用检查：

```sh
npm run build
npm run test:ui
npm run check
npm test
```

| 命令 | 覆盖范围 |
|---|---|
| `npm run build` | TypeScript 类型检查与 Vite 前端构建 |
| `npm run test:ui` | 前端纯逻辑、真实组件处理器及部分渲染／布局约束；不是原生 UI 自动化 |
| `npm run check` | cargo fmt 与启用测试故障注入的 clippy |
| `npm test` | Rust 领域、存储、迁移、回执与恢复测试；临时虚构资料 |
| `npm run test:demo` | 独立样例导入工具 |

故障注入 feature 只用于测试，不进入普通应用。检查结果按本次实际执行登记；测试文件存在、历史通过或源码提交不代表当前工作树已通过。文案／样式核对受影响页面与断点；表单验证保存、取消、未知与失败；计算运行对应数值和调用链回归。纯文档检查链接、锚点、术语和离线交付依赖。

### 临时目录残留导致样例测试失败

若历史样例测试因临时同级目录残留损坏资料而报“已有数据但缺少指针”，先保留现场，再用全新临时根目录重跑；不删除不明目录，不到正式库修复测试。

```sh
thingary_test_tmp=$(mktemp -d -t thingary-tests)
env TMPDIR="$thingary_test_tmp" npm test
```

## 浏览器预览

```sh
npm run dev -- --port 1429
```

访问 <http://127.0.0.1:1429/visual-preview.html>。页面仅使用内存虚构资料，刷新重置，不包含于普通发布构建；预览保存提示不证明原生持久化或系统文件能力。

| 参数／入口 | 用途 |
|---|---|
| `?state=empty`、`?state=error`、`?state=save-error` | 空白、读取失败、保存失败 |
| `?wealth=empty|first|error` | 账户与盘点状态 |
| `?section=planning&plan-basic=saved|unknown|negative|blank&capabilities=real` | 已保存通用规划、投入未知／负值、基础未填；真实纯计算 |
| `?section=planning&plan-basic=saved&capabilities=real&plan-core=confirmed` | 当前目标、大额计划、计算详情与真实报告入口 |
| `?plan=error`、`?plan-profile=empty` | 规划读取失败／没有已保存规划 |
| `?plan-core=occurred|partial|overdue` | 已发生接续、付款缺项与过期待核对 |
| `?section=planning&plan-debt=normal|unknown|empty|error|changed|zero|saved` | 已有贷款直接还款安排 |
| `?movement=populated|error` | 资金流动列表与读取失败；预览拒绝流动写入 |
| `?import-kind=incomes&import=normal|unknown|empty|error` | 收入导入展示状态 |
| `?state=components&style=bento&theme=light` | 共用表单、菜单、日期／月份控件 |
| `style=native|olive|bento`、`theme=light|dark` | 三种外观的浅／深组合 |

### 规划核算与实际发生预览

当前规划共用 `PlanningSources` 和真实 `buildBasicCapabilities`。未知投入仍可反求需求，预测保持缺项；临时投入不回写其他消费者。资金起点、事件付款、盘点吸收、剩余贷款、费用包含与受限资金分别检查，不用未知零值绕过校验。

`tests/planning-core.test.mjs`、`planning-basic-ledger-integration.test.mjs`、`planning-basic-consumers-integration.test.mjs`、`planning-coverage-consumers.test.mjs` 覆盖账本与共享结果；`src-tauri/tests/plan_profile.rs` 和 `planning_basic.rs` 覆盖事务、引用、事实保全、旧回执与恢复。旧政策／职业阶段夹具应显示待重新设置，不能重新进入旧估算路径。

### 金融导入解析与报告组件

外部表格只接受 Excel `.xlsx`。`spreadsheet.rs` 将受控工作表规范化为内部 CSV 文本，继续复用纯解析器；没有外部 CSV、OCR、银行格式转换或资金流动回导。解析器契约与虚构样例见[解析器说明](../src-tauri/src/financial_import_parser/README.md)。

`src-tauri/tests/financial_import.rs`、`financial_import_parser.rs`、`spreadsheet.rs`、`finance_export.rs` 和 `tests/financial-import.test.mjs` 覆盖外部键、同日冲突、未知／零、整批回滚、旧备份迁移、回执重放、删除可用性、中文路径、Excel 行号及恶意公式／ZIP／范围拒绝。覆盖声明与历史总额参考仍仅有纯解析能力，未接入产品。

容量测试默认跳过，独立串行运行；需要测量时用 `/usr/bin/time -l` 包裹测试进程，区分预览、提交、取消和构建峰值：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test financial_import maximum_ -- --ignored --nocapture --test-threads=1
```

总计 20 MiB／5 万行、5 万账户及已有 5 万账户的重复预览与取消已在 Apple M4／16 GiB、macOS 27 的 debug 测试进程通过。此测量没有既定产品耗时／内存阈值，不代表其他机型或 release 应用性能达标；分页不能缩减后端完整校验，取消不得留下写入。

独立报告预览 `/planning-report-preview.html` 仅展示固定虚构 v1 状态。真实当前报告入口另见[当前报告验证](#current-report-validation)，基准／比较与原生打印 PDF 未接入。组件契约与回归见[报告说明](../src/planning-report/README.md)和 `tests/planning-report.test.mjs`。

### 职业变化情景原型

`/career-preview.html` 使用虚构现金流比较空窗、降低投入或换工作。普通目标页的职业试算共用通用模型；关闭丢弃临时条件，不保存职业路线，不恢复政策待遇、资格或停续缴计算。

## 当前功能验证入口

<a id="finance-workspace-validation"></a>

### 财务工作区接入与联合验收

当前源码的财富入口为账户与盘点、收支记录和财务复盘，规划仅保留目标。`finance_sources` 在同一读取事务中返回期间事实，关闭来源不读取；收入、资金流动和目标分别门控，旧配置继承只执行一次。具体接入与验收清单见[统一设计](FINANCE_WORKSPACE_DESIGN.md#acceptance)。

前端回归入口为 `tests/finance-*.test.mjs`；Store 回归在 `src-tauri/tests/finance_sources.rs`、`plan_income.rs`、`expenses.rs`、`investment_review.rs`、`planning_flow.rs` 与 `financial_import.rs`。核对完整盘点、收入分类、区间端点、互斥流动来源、切库、迟到响应、来源返回和未知回执；不要把独立切片测试当联合验证。

隔离原生已覆盖收入／支出／转账、账户／完整盘点、投资核对及失效重确认、系统备份保存／选择／恢复、Excel 导出／收入导入与重启。日期与年份控件、普通来源返回及保存焦点也已抽查；完整键盘、全部系统输入法和通知实际送达仍未完整覆盖。公开版本、本机安装与本轮源码验证分别记录，不能互相替代。

### 通用规划基础联合验收

四问在内存编辑，最终 setup 一次事务保存；后续分区修改只改对应条件。回归 `planning-basic-ui`、`planning-basic-service-integration`、`planning-fourq-components`、`planning-debt` 与 `planning-component-runtime`；Rust 重点为 `plan_profile.rs`、`planning_basic.rs` 和 `tests/helpers/planning_migration.rs`。旧政策输入退出，真实资产、收入、付款、附件、稳定 ID 和历史回执继续保全。

需求与预测门控独立，完整预算／零终点判据、收益上下调 200 bps、月初付款顺序、引用去重与模型标注共用现行账本。风险与来源回归见 `tests/plan-risk.test.mjs` 和 `source-provenance.test.mjs`；来源与许可另见 [SOURCE_NOTICES](../SOURCE_NOTICES.md)。

### 收入分类与投资区间接入验证

`income-classification`、`income-records`、`investment-review-host`、`planning-followup-ui` 与 Store 的 `plan_income`、`investment_review`、`planning_flow` 测试覆盖分类事实、手填／明细互斥、区间重叠、更正／删除／恢复失效及旧请求兼容。独立损益组件可运行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --example investment_review_contract
```

假设四字段、资金流动、关联来源、端点更正、失效重确认、完整备份／Excel 与重启已做隔离核心原生验证。端点更正和资金流动更正应使用不同受控原因，不改变保存前依据校验；备注更正不应撤销确认。原生故障注入与完整操作矩阵不由 Store 测试推定。

<a id="current-report-validation"></a>

### 当前规划报告预览与验证边界

“查看当前报告”使用同一批已保存来源与领域能力，经 v1 校验生成独立只读快照。普通刷新不替换正文；切库、恢复、规划关闭或离开目标使其失效。未知投入不补零；影响计算的遗漏或未确认假设限制结论。只展示列明的账户资金、结构化条件、需求与已有确定性输出，不造逐月趋势、逐项购买结果或历史比较。

回归在 `planning-report-current-adapter.test.mjs`、`planning-current-report.test.mjs` 和 `planning-report.test.mjs`：快照脱离来源、错误和上下文失效、未知／零／负、费用遗漏、未来收入基准、稳定别名、隐私及复制失败重试。真实入口默认隐私，无打印／PDF；完整与隐私都从同一快照投影，不把隐藏金额留在 DOM／可访问文本或复制输出。

隔离原生已验证隐私／完整金额与盘点一致、隐私摘要的真实剪贴板回读、Tab 模态循环、Escape 返回、三主题明暗稳定窄窗截图及重启不保留报告。快切主题的过渡帧不作为常态表面缺陷；截图前等待主题与页面稳定。目标网格宽度修复后的 900×720 原生窗口无整页横滚，表格保留内部滚动。收入保存的禁用触发按钮回退页标题已原生复验。旧前后图 Retina 比例不同，不称严格同像素对照；浏览器 DOM 矩阵也不冒充截图验收。

## 样例与原生验收

`npm run demo:import` 只用于独立开发预览。`src-tauri/examples/` 的夹具有各自身份保护，调用前检查；不得把正式包或真实备份复制成夹具。人类任务反馈可用[规划任务测试](PLANNING_TASK_TEST.md)，代理操作不能代替真实用户的理解与完成度。

界面变更核对 1440×1000 与 900×720、三主题明暗、正常／未知／空白／错误，以及保存、取消、焦点和键盘。涉及原生文件、持久化或通知时，另用隔离身份验证相应边界。全矩阵在阶段集成或发布前集中执行，小改动按影响范围复验，未验范围明确登记。

当前只在 Apple Silicon、macOS 27 实测。macOS 14 最低打包目标不是兼容验收；Intel、VoiceOver、显示缩放、完整键盘、全部输入法组合与通知送达仍不能宣称完成。豆包拼音仅在支出名称验证组合、Space 提交和 Escape 顺序，不推广为所有表单通过。

### README 与使用指南截图

公开截图均使用虚构资料。来源、尺寸与复现路径只维护在[截图清单](images/README.md)，照片内容更新不能仅改名或由浏览器图替代原生能力证明。纯文档更新检查链接／锚点／图片，生成离线指南并核对内部跳转：

```sh
node scripts/offline-guide.mjs <临时输出目录>
```

## 构建应用

```sh
npm run tauri -- build --bundles app
```

默认产物 `src-tauri/target/release/bundle/macos/Thingary Preview.app` 使用开发预览身份。正式包由维护者运行 `npm run release`；版本、签名、公证、支持平台和公开附件按[发布流程](RELEASING.md)核验，不由源码检查推定。

源码与现行文档只在本仓库维护。修改行为同步 PRODUCT_RULES，修改操作同步 USER_GUIDE，修改实现取舍同步 ARCHITECTURE；设计状态由 INDEX 导向唯一规格。外部贡献者无需访问私有过程记录即可构建、测试或理解约束。
