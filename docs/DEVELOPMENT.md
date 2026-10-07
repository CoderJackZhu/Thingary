# 开发与测试

本文面向贡献者。只想使用软件，请直接[下载安装包](USER_GUIDE.md#download)。提交规则见[贡献指南](../CONTRIBUTING.md)，业务约束见[业务规则](PRODUCT_RULES.md)。

## 准备环境

需要 Mac、Xcode 命令行工具、Node.js 与 npm、Rust 稳定版工具链；CI 使用 Node.js 22 与 Rust stable。Rust 链接 macOS 原生框架，不能把 Linux 上的前端构建当作完整应用构建。当前开发与发布只在 Apple Silicon 验证。

```sh
git clone https://github.com/CoderJackZhu/Thingary.git
cd Thingary
npm ci
npm run tauri -- dev
```

使用仓库锁文件，不随意升级依赖。开发窗口的标题为「物谱 · 开发预览」，身份是 `local.thingary.preview`；它和正式版的资料分开。开发、测试、验收一律使用虚构资料，不能打开或写入正式库 `local.thingary.main`。

## 浏览器预览

```sh
npm run dev -- --port 1429
```

打开 <http://127.0.0.1:1429/visual-preview.html>。预览使用内存样例，刷新重置，不证明原生文件操作或持久化可用，也不包含在正常发布构建中。

| 参数 | 要观察的状态 |
|---|---|
| `?state=empty` | 空列表 |
| `?state=error` | 读取失败 |
| `?state=save-error` | 保存失败 |
| `?wealth=empty`、`?wealth=first`、`?wealth=error` | 账户与盘点状态 |
| `?expenses=empty`、`?expenses=error` | 重要支出状态 |
| `?recurring=empty`、`?recurring=error` | 周期费用状态 |
| `?section=planning`、`&plan=empty`、`&plan=error`、`&plan=reasons-error`、`&plan-profile=empty`、`&plan-budget=set`（虚构月预算 5000 元，也可传非负元数如 `&plan-budget=6000`）、`&plan-mode=traditional`（传统类型、期望 60 岁）、`&plan-items=1`（虚构医疗、旅行支出与企业年金收入）、`&plan-return=1`（实际收益率 1.5%／1%）、`&plan-phases=1`（虚构储蓄阶段：空窗、有收入、清闲）、`&plan-route=soe`（35 岁起选国企路线，可选 soe／civil／tech／flex）、`&plan-events=1`（虚构大额计划：北京买房、老家全款买房、二手车）、`&plan-wishes=dates`（心愿设日期：未来、已过、无价格） | 规划页：虚构月度收入、无收入、读取失败、复盘「原因」区局部失败、养老金页尚未填写个人资料 |
| `?plan-fail=profile`、`?plan-fail=review`、`?plan-fail=income`、`?plan-fail=snapshot` | 首页规划来源局部读取失败；成功的历史储蓄可独立保留 |
| `?section=recurring&recurring-fixture=layout` | 长名称、历史订阅费用与未设置服务覆盖期的计划，检查窄窗口换行 |
| `?theme=dark`、`?no-photos` | 深色与缺少照片 |
| `?search=error-once` | 搜索首次查询失败，点击「重新搜索」后恢复（仅内存桩） |
| `?wish-fixture=layout&replacement-read=error` | 原物品资料读取失败、重试入口（虚构读取失败） |
| `?source=missing` | 搜索结果来源校验失败，保留提示并刷新结果 |

参数按 URL 查询规则组合，例如 `?state=error&theme=dark`。不要把真实资料复制到预览。

### 规划核算与实际发生预览

在独立开发树运行 `npm run dev -- --port 1429`，访问 `http://127.0.0.1:1429/visual-preview.html?section=planning&plan-budget=set&plan-core=confirmed`。`plan-core=occurred` 展示虚构已吸收首付／余债接续；`partial` 展示部分付款缺项；`overdue` 展示逾期待核对。去掉 `plan-core` 可核对旧自动参考／规则缺省；`state=empty`、`plan=error` 与 `state=save-error` 检查空、读取失败和保存失败。全部是内存夹具，刷新重置，不代表原生或持久化验收。

`tests/planning-core.test.mjs` 覆盖资产事实、分池、已含费用、余债与首月顺序。`src-tauri/tests/plan_profile.rs` 对真实临时 Store 测试 core 保存、修订冲突、提交后回执丢失重放、重启、备份恢复、引用更正和 schema30→31 回滚。不得对正式资料库运行。

### 金融导入解析与报告组件

金融 CSV 解析器的契约、虚构样例和待接入边界见[解析器说明](../src-tauri/src/financial_import_parser/README.md)，回归位于 `src-tauri/tests/financial_import_parser.rs`，由 `npm test` 执行。它不写入数据库。

运行 `npm run dev -- --port 1431`，访问 `http://127.0.0.1:1431/planning-report-preview.html` 查看[只读报告组件](../src/planning-report/README.md)的虚构状态与隐私输出；`tests/planning-report.test.mjs` 由 `npm run test:ui` 执行。预览不进入正常发布构建；真实报告适配、产品入口及原生 PDF／文件对话框尚未接入。

## 自动检查

在仓库根目录执行：

```sh
npm run build
npm run test:ui
npm run check
npm test
```

| 命令 | 实际覆盖 |
|---|---|
| `npm run build` | TypeScript 类型检查与 Vite 前端构建 |
| `npm run test:ui` | Node 运行前端纯逻辑／格式／布局约束检查，不是原生 UI 自动化 |
| `npm run check` | cargo fmt 与启用测试故障注入的 clippy |
| `npm test` | Rust 领域／存储测试，使用临时目录与测试故障注入 |
| `npm run test:demo` | 虚构样例导入工具的测试 |

代码或数据语义改动完成相应检查，并更新有意义的行为样例。纯文档改动检查链接、图片、锚点、规则和分发材料依赖；不要用旧工程结果冒充新的验收。

### 临时目录残留导致样例测试失败

一项历史样例测试会在临时目录的同级打开样例库。若默认临时目录遗留损坏的样例而报“已有数据但缺少指针”，可用全新临时根目录重跑；先保留失败现场，不删除不明目录，也不要到正式资料库中修复测试。

```sh
thingary_test_tmp=$(mktemp -d -t thingary-tests)
env TMPDIR="$thingary_test_tmp" npm test
```

临时根目录仅对这次命令生效，其中只允许存放虚构测试资料；这不会修复真实资料，也不代替定位其他测试失败。

## 样例与原生验收

`npm run demo:import` 只针对独立开发预览。`src-tauri/examples/` 提供专用虚构夹具，调用前检查身份保护；不能把正式版打开后当作测试环境。

界面改动至少检查正常、未知、空白、读取／保存失败，以及三种风格的浅／深组合。保留同尺寸对照，验证键盘、焦点与窄窗口。涉及选择文件、通知、备份恢复或重启持久化时，用同代码的全新隔离身份包做原生验收，报告已做与未做的步骤。

## 构建应用

```sh
npm run tauri -- build --bundles app
```

默认产物是 `src-tauri/target/release/bundle/macos/Thingary Preview.app`，使用开发预览身份。正式打包由维护者运行 `npm run release`，详见[发布流程](RELEASING.md)；故障注入仅用于测试，不带入普通应用。

## 日常工作方式

源码和当前有效文档只在本仓库维护。功能或修复采用短期分支，经检查提交；公开协作使用 issue／PR。个人过程笔记可以另存私有仓库，但外部贡献者无需访问该仓库即可构建、测试或理解业务规则。

修改业务行为时更新 PRODUCT_RULES，修改使用步骤时更新 USER_GUIDE，修改实现取舍时更新 ARCHITECTURE。文件职责与维护者的两仓库流程见[文档维护](MAINTAINING.md)。

### 规划首次设置验收

`tests/planning-setup.test.mjs` 覆盖草稿无副作用、未知与明确零、负数阶段、费用包含关系、实际付款 ID 保留及资产事实不变。Rust `guided_setup_marker_is_backward_compatible_and_preserves_facts_through_restore` 覆盖旧资料兼容、规划保存前后账户／盘点／收入／复盘不变与备份恢复。虚构预览 `/visual-preview.html?section=planning&plan-budget=set&plan-route=soe&plan-events=1` 用于旧计划的首次引导；`plan-profile=empty`、`state=save-error` 用于空白与保存错误。检查跳过、返回步骤、重复进入、账户名称、1440×940 与 800×600、键盘和保存后刷新。原生验收使用独立身份，不打开正式资料库。
