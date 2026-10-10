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
| `?expenses=empty`、`?expenses=error` | 独立支出空白／重要支出读取错误；全来源空白用 `?state=empty` |
| `?recurring=empty`、`?recurring=error` | 周期费用状态 |
| `?merge=1` | 周期费用／虚拟资产页顶部的旧订阅合并提示与确认弹窗（一对虚构候选，确认后本次预览不再出现） |
| `?link=error` | 关联订阅详情／整组删除预览的读取失败 |
| `?section=planning&plan-basic=blank|unknown|negative|saved|beijing-complete`，数值验收另加 `&capabilities=real`；`&plan=error`、`&plan-profile=empty`、`&state=save-error`；旧载荷夹具 `&plan-phases=1&plan-route=soe&plan-budget=set` | 通用目标、投入未知／负值、已保存及北京缴费、读取／保存错误；旧载荷应显示待重新设置，阶段／路线不是活动功能 |
| `?plan-fail=profile`、`?plan-fail=review`、`?plan-fail=income`、`?plan-fail=snapshot` | 首页规划来源局部读取失败；成功的历史储蓄可独立保留 |
| `?section=recurring&recurring-fixture=layout` | 长名称、历史订阅费用与未设置服务覆盖期的计划，检查窄窗口换行 |
| `?theme=dark`、`?no-photos` | 深色与缺少照片 |
| `?search=error-once` | 搜索首次查询失败，点击「重新搜索」后恢复（仅内存桩） |
| `?wish-fixture=layout&replacement-read=error` | 原物品资料读取失败、重试入口（虚构读取失败） |
| `?source=missing` | 搜索结果来源校验失败，保留提示并刷新结果 |

参数按 URL 查询规则组合，例如 `?state=error&theme=dark`。不要把真实资料复制到预览。

共用操作组件样例使用 `?state=components&style=bento&theme=light`，包含空白、错误、禁用、长提示、日期与月份。`style=native|olive|bento` 与 `theme=light|dark` 组成六种外观；在真实新增物品、账户、计划及大额计划表单中继续检查。日期浮层应覆盖 1440 × 1000、900 × 720、底部向上展开、滚动／缩放后定位、方向键、年月跳转、Escape 返回及 Tab 离开；月份回传值只有 YYYY-MM。详细规格见 [共用界面设计](VISUAL_SYSTEM_DESIGN.md)，样例与浏览器结果不替代原生验收。

养老金预览可追加 `?section=planning&plan-basic=saved&capabilities=real&plan-pension=custom`（自填地区完整参数）或 `plan-pension=custom-missing`（已选其他城市但缺计发基数）；`normal|unknown|empty|error` 覆盖原有正常、未知、空白和读取失败。检查目标卡、国家养老金小窗口、养老金参数表与第四问手填／折算，全部仅驻留虚构内存。

### 规划核算与实际发生预览

在独立开发树运行 `npm run dev -- --port 1429`，访问 `http://127.0.0.1:1429/visual-preview.html?section=planning&plan-basic=saved&capabilities=real&plan-core=confirmed`。`plan-core=occurred` 展示虚构已吸收首付／余债接续；`partial` 展示部分付款缺项；`overdue` 展示逾期待核对。去掉 `plan-basic` 可核对无通用输入时待重新设置；`state=empty`、`plan=error` 与 `state=save-error` 检查空、读取失败和保存失败。全部是内存夹具，刷新重置，不代表原生或持久化验收。

`tests/planning-core.test.mjs` 覆盖资产事实、分池、已含费用、余债与首月顺序。

轻量复盘夹具在同一预览入口追加 `review-fixture=normal|no-income|scope|incomplete|no-plan|pending`：分别覆盖净资产增加60000元、无收入、计入范围变化、旧盘点缺金额、无计划和逾期安排。原因桩固定含一条 null 金额行；`plan=reasons-error` 检查原因局部失败，`plan-module=off` 检查保存后降级到账户变化，`plan-wealth=off` 检查隐藏财富不读取。主题用 `style=bento|native|olive`、`theme=light|dark`，宽窗1440×1000及窄窗900×720。夹具全部虚构、仅驻留内存。`review-fixture=history` 增加三段可比历史（含非零投资变化），用于核对复盘中位数、第二问与详情建议；`review-fixture=hpf-unknown` 使用同一历史但缴存未知，用于核对只撤下花销估计；`review-fixture=no-investment` 保留三段历史并不计入投资账户。

`tests/review-observations.test.mjs` 覆盖观察顺序与上限、禁用词、无收入资产事实、退款／售出符号、未知与明确零、结构化待核对兼容及确认后余额不变；`src-tauri/tests/plan_income.rs` 回归区间原因的 null 金额、日期／模块过滤与排序。`plan_interval_reasons` 保留日期及模块范围内未知金额行，金额继续为 null。原生保存→提示→对应区间→核对→重启须使用独立验收身份另行登记；浏览器截图和 Store 测试不替代原生、备份恢复或文件选择验证。

关联订阅生命周期（组删除／恢复、共享保存双方修订、预览失效、历史归组与备份往返）在 `src-tauri/tests/link_groups.rs` 对临时 Store 验证（旧订阅合并发现在 `src-tauri/tests/link_merge.rs`）；其中 schema32→33 矩阵覆盖主分支的无组表版本与未发布订阅分支的完整组表版本，检查升级、旧备份恢复、规划载荷与稳定 ID 保持、非法结构拒绝及事务回滚。重要支出年度桶的固定金额样例在 `src-tauri/tests/expenses.rs`（`annual_buckets_match_design_example`），前端桶口径在 `tests/expense-annual.test.mjs`。`src-tauri/tests/plan_profile.rs` 对真实临时 Store 测试 core 保存、修订冲突、提交后回执丢失重放、重启、备份恢复、引用更正和 schema30→31 回滚。不得对正式资料库运行。

### 金融导入解析与报告组件

金融 CSV 解析器的契约、虚构样例和组件边界见[解析器说明](../src-tauri/src/financial_import_parser/README.md)，回归位于 `src-tauri/tests/financial_import_parser.rs`，由 `npm test` 执行。它不写入数据库。

P1-3A 的账户／完整盘点写入回归在 `src-tauri/tests/financial_import.rs`：24 个月、真实目录完整性、整组冲突／修订、历史覆盖、回滚无回执、失联重启重放、切库／模块失效、永久清除墓碑、同批重导入的已删除／清除数量及恢复／重启／更换映射集合、schema33→34 升级失败回滚及旧／新完整备份。`src-tauri/tests/wealth.rs` 对原命令的 generation／UUID／原指纹／回执／故障点保持回归；`recovery.rs` 的旧 schema 恢复日志用例证明并覆盖升级前恢复。故障注入仅在测试 feature 中启用。

删除后旧回执补丁已由临时 Store 与虚构浏览器对照验证；原生删除→重导入提示及恢复全过程尚未验。

`tests/financial-import.test.mjs` 覆盖删除回执日期／数量／下一步提示、表头、动作修订、文件替换、整数金额／未知、仅请求元数据、分页、稳定候选、行号范围及恢复保留未知请求。浏览器预览 `/visual-preview.html?section=wealth&import=normal|unknown|empty|error` 为虚构内存桩，不证明原生写入；四状态已核对三种外观、明暗及 1200×800 / 520×800 同尺寸基线对照。

容量用例默认 ignored，单独运行并用 `/usr/bin/time -l` 测量测试进程：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test financial_import maximum_ -- --ignored --nocapture
```

覆盖总计 20 MiB / 50000 行、50000 个账户、已有 50000 账户的重导入与取消。上限不因分页缩减后端验证；取消在目录扫描、复制和解析检查点生效。独立原生身份已验证中文路径选文件、24 个月事务回执、重启、旧 schema33 备份恢复、新 schema34 备份往返和 20 MiB / 50000 行取消且无写入。故障失联／预览后切库与模块循环由临时 Store 回归证明；原生 UI 故障注入、VoiceOver、输入法组合及其他系统／架构未逐项验收。

运行 `npm run dev -- --port 1431`，访问 `http://127.0.0.1:1431/planning-report-preview.html` 查看[只读报告组件](../src/planning-report/README.md)的虚构状态与隐私输出；`tests/planning-report.test.mjs` 由 `npm run test:ui` 执行。预览不进入正常发布构建；真实报告适配、产品入口及原生 PDF／文件对话框尚未接入。

### 职业变化情景原型

运行 `npm run dev -- --port 1438`，访问 `http://127.0.0.1:1438/career-preview.html`。页面默认是向导式界面（`guided.tsx`，答案放最前、社保算进花销、假设可见可改；`?lab=1` 打开原来的完整面板），用虚构资料回答三个问题：保持退休目标最长可空窗多久、再做多久可以降低投入、换工作后每月至少要攒多少；`?state=retirement|pension|unknown|empty|error|shortfall` 加载无受限池的收入选择、北京养老金与公积金、恢复未知、无资料、读取失败和月内付款不足的样例。独立页面刷新或关闭即丢弃，不调用原生服务、不写存储，其 HTML 不进入普通应用导航和发布构建。共享 `GuidedPanel` 已由目标页内 `PlanningCareerCard` 使用，属于 0.0.2 正常应用。

以下两段描述 `?lab=1` 实验面板；尚无已保存收入选择的向导默认先不计退休收入，已有选择优先，假设可见可改，不能把实验面板的初始门控当作向导默认行为。应用入口可在 `/visual-preview.html?section=planning&plan-basic=saved&capabilities=real` 中打开职业试算核对，操作见[使用指南](USER_GUIDE.md#career-trial)。

实验面板先选择本次退休收入口径，再填写收支、可选到账和实际社保费用，之后是唯一结果区。手填复用稳定 ID 的收入明细或添加临时假设，按整岁起止只计退休后的区间；没有自动采用旧北京估算金额或核对面板结果。“不计任何退休收入”须主动选择，排除养老金和年金等全部项；默认沿用原计划选择，未知不补零。首版不要求无法影响手填收入的缴费基数，只要求实际费用和已含／另付关系，工作工资已扣的部分不再重复扣除。恢复储蓄未知仍可反求需求，依赖它的搜索／预测不出答案；退休收入或恢复阶段缺项不抹去之前已知的局部空窗检查，局部结果不冒充最长空窗。

可主动勾选粗略估计，仅将未填的社保现金按无需自己支付暂估，并标明偏乐观，已填非法值与恢复储蓄不替代。数字、条件、收入选择和标注来自同份延迟数据，更新期间撤下旧答案；单项对照输入保持挂载，切换条件与逐键输入不收起面板或丢失焦点。主答案在视野内时不重复底栏；关闭重开、更换样例重置，不保存。

实验面板的 `retirement` 样例初始选择自动北京收入，需主动改选本次手填／不计收入才提供长期答案；`pension` 样例保留未来公积金缴存，改选手填也因受限池依赖阻断。参与受限池估算的资料不清空事实或假定已解锁；已有明确排除／零参与的账户仍保留原记录。独立养老金核对面板不解锁职业搜索。契约与出口见[首版范围与输入](CAREER_SCENARIO_DESIGN.md#首版支持范围与输入冻结)：计算、浏览器交互与当前首版状态截图已核对：1280×900 和 420×900 覆盖正常、缺项、错误、空资料及受限池阻断；正常答案覆盖三种外观明暗模式。Ego 截图超时后使用应用内浏览器补齐，未取得历史版本的同尺寸截图；完整用途观察与原生验收尚未完成。

测试：`tests/career-income-scope.test.mjs`（临时收入选择、缺项、受限池门控、独立逐月金额与现金去重、非零收益／通胀下多笔收入起止和少一分边界）、`tests/career-insurance.test.mjs`（相同基数不同输入方式的公积金一致性、非法值阻断）、`tests/plan-career.test.mjs`（真实来源形态的编译、费用去重、缴费对资格与受限池的影响、付款先后、缺项、固定目标反求）、`tests/plan-career-map.test.mjs`（搜索、阶段费用、补助、一次性收入、社保去重）、`tests/career-differential.test.mjs`（固定种子的随机虚构情景，引擎与独立逐月账表比对：60 个目标资产与退休需求、16 个最长空窗，需逐分一致）、`tests/plan-career-reference.test.mjs`（独立核算，预期值由 `tests/helpers/career-reference.mjs` 逐月计算，不导入生产引擎；范围与未验证项见契约“唯一结果与独立核算”），均包含在 `test:ui` 中。浏览器和视觉核验记录保存在内部笔记，不在此逐轮记录。独立逐月核对表可用 `node scripts/career-benchmark.mjs > /tmp/career-benchmark.json` 复现，包含完整虚构输入、预期、实际与差值，不读取资料库。目标页已接入可选、默认收起的临时试算卡片；独立预览页仍不进入发布构建。用户用途验证与全部原生交互验收尚未完成。

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

`tests/planning-basic-ui.test.mjs`、`planning-basic-service-integration.test.mjs` 和 `planning-basic-consumers-integration.test.mjs` 覆盖统一保存、未知／零／负数、草稿无副作用和原回执防覆盖。Rust `src-tauri/tests/planning_basic.rs` 覆盖旧资料只读适配、事实与稳定ID保全、旧备份恢复、旧回执重放及完整保存事务；`plan_profile.rs` 覆盖付款、吸收关系、余债与来源引用。旧阶段／路线夹具应显示「待重新设置」，目标／预算／投入不得自动带入。浏览器覆盖正常、未知、空白和错误状态，同尺寸比较新旧入口；截图或原生功能未完成时记录限制。原生使用独立身份，数据必须虚构。


## 通用规划基础联合验收

第一批将真实 `buildBasicCapabilities` 绑定到基础界面，四问输入只在内存持有，Q4 最终 setup 一次事务保存；收入明细、资金规则和养老字段不能分次留下半成品。`tests/planning-basic-service-integration.test.mjs`、`planning-basic-consumers-integration.test.mjs` 与 `planning-basic-ledger-integration.test.mjs` 覆盖真实provider、来源同批、未知／临时隔离、费用作用域、受限池一次解锁、原回执防覆盖；Rustplanning_basic覆盖引导完整保存、失败回滚、重放和独立养老金。Worker覆盖仅保存规划后重启仍进入个人库。

浏览器 `?section=planning&plan-basic=unknown&capabilities=real` 使用虚构来源和真实纯计算；不加capabilities参数的异常状态仍为展示夹具，不能当数值验收。原生使用独立bundle标识 `local.thingary.basic.acceptance.20261007`，实测新建模拟起点、添加手填退休收入、保存后投入保持null、目标／首页需求一致、重启恢复。未完成全套原生VoiceOver、真实中文输入法组合及三主题全窗口矩阵；浏览器证据不替代这些范围。未访问正式库，不代表正式包已安装或公开发布。

## 固定当前收支工具与收益对照

运行`npm run test:ui`覆盖`plan-runway.test.mjs`及`planning-basic-consumers-integration.test.mjs`。重点核对空白不等于零、月初支付／月底到账、现金流持平仍可能触底、无法支付时仍有余额、所选检查期、无目标手填入口和临时输入不写入。基础风险页只构建六个通用压力条件；无旧职业估算路径，但完整预算及零终点说明与计算一致。收益升／降200 bps均局部反求，越界不计算，也不回写预计投入。界面验收只用隔离身份和虚构资料，记录原生与浏览器证据；VoiceOver／真实中文输入法及完整主题窗口矩阵不能由自动检查推定通过。

### 规划源码来源回归

第三方告知见 [SOURCE_NOTICES](../SOURCE_NOTICES.md)。`tests/source-provenance.test.mjs` 只保存已移除上游文案的长度和散列，防止完整值重新出现，不将通过散列检查当作许可认证。`tests/plan-risk.test.mjs` 验证零波动与同一月账本一致、月初资金缺口不能由随后解锁掩盖、规划终点恰好为零的成功口径，以及无提款时相同年度收益排列的终点余额一致（含不足一年的终点）。打包告知除包管理器依赖外还收集根目录 `SOURCE_NOTICES.md`；生成器不会自动判定新内置内容的授权，新增来源须同步登记。


基础规划的操作层可用 `?section=planning&plan-basic=beijing-complete` 查看已保存北京选择与隐藏缴费资料保全；`plan-basic=blank|unknown|negative|saved` 分别检查空白、预计投入未知、负值与已保存。`state=save-error` 检查保存失败保留输入。`section=virtual` 的虚构创作服务可查看关联订阅的结束确认窗；`section=expenses` 检查年度柱图进入月度回顾及金额待补提示。合并共用控件时，`tests/cent-input-interactions.test.mjs` 验证真实输入处理保持负整数分、零、未知与字段说明关联。

北京养老金政策专项用例运行 `node --test tests/plan-pension-policy.test.mjs`；`node --test tests/plan-pension-contract.test.mjs` 验证独立的显式输入金额核心（缺项／不适用门控、年份、计发月数、金额舍入和次月起领）。`node --test tests/plan-pension-index.test.mjs tests/plan-pension-timing.test.mjs` 验证完整日历年指数与独立账本起领适配器，覆盖普通停缴、整年待遇扣除、精确舍入、缺项和部分年份阻断，以及退休月、跨年、月中起点、池解锁和展示一致性。适配器仅支持显式购买力转换与领取后随通胀增长假设，未被普通入口或预览调用。

`node --test tests/plan-pension-account.test.mjs tests/plan-pension-candidate.test.mjs` 验证已结息年末余额后的账户情景外推与完整年度候选串联；覆盖停缴继续计息、8%入账、逐年利率、年度与末年假设、整数分舍入、缺项／非法／不适用、退休月一致性及资格不足不退款。新候选位于 `plan-pension-candidate.ts`，既有 `plan-pension-path.ts` 的缴费区间编译保持不变，不能以新候选替换普通入口。

`node scripts/pension-policy-audit.mjs` 并列旧模型、新金额核心及给定指数下的闭式金额，另输出完整年度指数→金额→逐月账本以及三种缴费候选的独立预期和实际，差异时退出码非0；原逐月加权指数仍是假设，不能称为官方待遇差额。首尾部分年份、官方账户结算校准和职业搜索接入尚未完成。职业预览的 `?state=pension` 已提供可展开的金额核对，初始条件未知，主动载入完整虚构假设后显示分项、资格和次月起领；清空、非法值和其他适用范围均撤销金额。三个职业主答案与所有对照暂时阻断，核对结果不进入搜索或账本。`tests/career-pension-preview.test.mjs` 验证预览门控、来源错误优先、历史事实不冒充未来输入及核心连接。范围与后续出口见 [职业情景设计](CAREER_SCENARIO_DESIGN.md#北京养老金政策核验与接入门槛)。

### README 与使用指南截图

当前截图的应用基线、统一视口、虚构数据和操作路径见[截图维护清单](images/README.md)。截图更新后生成离线指南，检查图片内容及锚点；浏览器截图不代替隔离原生验收。

P1-3B 收入回归覆盖 I02/I03/I07/I09/I11：空缴存与零、同日同额不同编号、收入非法行、混合事务故障、失联回执重启、映射与备份往返。`financial_import` 集成测试另覆盖 x11 替表中途回滚／外键校验、34→35／33→35 和旧 34 备份／回执；`finance_export` 验证未知空单元格、零 `0.00`。`plan_income` 与前端 `plan`／`planning-basic-defaults`／`review-observations` 验证到账与资产事实保留、独立花销样本及 P1-1 观察语义。浏览器布局夹具 `?import-kind=incomes&import=normal|unknown|empty|error`、`?hpf=unknown` 仅验证展示；原生 UI 与故障测试分开登记，具体记录保存在私有笔记。


### 四问目标引导与精修入口

`?section=planning&plan-first-run=0|1|2|2b|overdue|costs|beijing&capabilities=real` 使用虚构来源和真实纯计算，分别覆盖未设置、未答完、有结果、组合阻断、过期计划、费用待核对与北京资料不足。`state=save-error` 注入保存失败；结果点「修改」检查带值、每屏保存、预计储蓄与更多假设。所有浏览器夹具仅在内存，刷新重置。1200/520 宽、三种外观浅深的浏览器证据不代表原生验收。

`tests/planning-first-run.test.mjs` 覆盖四种状态、首个未答与数量、收入默认/已保存选择、北京隐藏资料保全、条件芯片、费用项目与数量、已保存大额计划数量（职业试算不保存，无数量）。`tests/planning-fourq-components.test.mjs` 执行实际向导事件处理器，验证关闭/Esc/跳过不提交、编辑带值与每屏保存、失败保留输入可重试、结果未知锁定及工具折叠；叶控件和保存器使用测试替身，无新增依赖。既有消费者集成测试仍用真实 React 渲染与纯计算。

未关联事件的已有贷款显示「告诉我你的贷款怎么还」，直接打开逐账户还款安排；通用付款引用待核对仍显示「核对已有贷款与付款」，使用现有大额计划表入口。有明确事件的过期计划仍逐个打开核对窗口，不跳总表。

2b 仅保留硬阻塞，非阻塞缺项显示带覆盖说明的状态 2；存储契约不变。测算详情保留 `PlanningBasicDetail.tsx` 概览 `RequirementCard` 和 `NeedContribution` 的非预计投入阻断分支旧按钮；它们涉及需求/预测/临时试算多路跳转，本任务未统一替换。原生验收必须使用独立 bundle 标识 `local.thingary.planning.fourq.acceptance20261009` 与虚构资料；验收包供独立运行，不代表安装、发布或生产库验收。


四问隔离原生已验：全新个人资料 0→Q1–Q4→结果；编辑模式六屏带值、保存并返回；关闭/Esc/跳过重新打开无草稿；原生文件选择器完整备份、修改、恢复后结果状态重建。北京保全使用精确旧 main 的真实 Store 写入虚构既有资料，再由当前原生向导修改生活费；整个 profile 对比仅生活费变化，含已选收入、养老金事实、缴费安排、隐藏参数、费用与稳定 ID 均保留。重启后状态由保存资料重新推出。尚未验：VoiceOver、真实中文输入法组合、原生三种外观浅深全尺寸矩阵、原生保存故障注入（浏览器/组件测试已覆盖失败与结果未知）。没有访问正式库，验收包未安装、发布。

非阻塞回归使用 tests/fixtures/planning-basic/nonblocking-demo.json，由 demo_finance::import_plan 同批真实导入并规范化虚构 ID 生成；原始样例 Q3 已声明每个计入资产的 available/restricted。planning-nonblocking 测月账本/事实保全，planning-fourq-components 测第三问保存 2b→2 与发生窗口，planning-coverage-consumers 遍历共享消费者并以真实 React 检验摘要。预览 ?section=planning&plan-nonblocking=normal|unknown|empty|error|funds|beijing 使用该批数据与真实纯计算。原生验收身份 local.thingary.nonblocking.acceptance20261010，与正式库隔离；缓存用 build-dir 或 /private/tmp/thingary-build-nonblocking，交付前删除。

## 已有贷款直接还款安排

虚构入口 visual-preview.html?section=planning&plan-debt=normal&theme=light；plan-debt 支持 normal、unknown（可空付款／期限）、empty、error（保存失败）、changed、zero、saved。均用 tests/fixtures/planning-basic/debt-loops.json，真实 capabilities，保存后重新读取与重算，刷新重置。tests/planning-debt.test.mjs 执行生产处理器、两张卡闭环、部分保存、三种账本、未知、阶段、事件去重和余额变化；Store plan_profile 的 debt 测试覆盖备份、非法载荷／引用、旧缺省、重启、冲突、提交未知重放，legacy receipt 测试保护旧字节。原生 UI、VoiceOver、系统输入法未验；隔离验收 identifier local.thingary.loops.acceptance20261010。

### 养老金精修闭环验收

当前源码已实现（尚未发布）。`?section=planning&plan-pension=normal|unknown|empty|error|transfer` 使用与自动化同批的虚构盘点：正常有完整社保资料、未知为已选北京缺两项资料、空白无计划、错误模拟保存失败、transfer 为个人养老金未来起止未齐。刷新重置，正常构建不导入预览夹具。

`tests/planning-pension-refinement.test.mjs` 运行生产对话框、Q4 和卡片处理器，覆盖五个入口、缺项硬阻塞与改选先不算、内存草稿与统一 setup 保存、隐藏值保全、未来缴存只扣一次，以及固定比较上下文、无原结果／不变／不可计算；原生临时 Store 的 setup 多段保存、null、原子性、重启、冲突和未知回执重放由 `src-tauri/tests/planning_basic.rs` 验证。浏览器可点通与截图不证明原生 UI 持久化；隔离原生 UI 的保存、重启、备份交互及辅助功能仍需另行验收。

从「核对未来缴存安排」卡片或其计算依据进入是一个明确例外：先不算／手填也显示同一个缴费步骤，用于补齐真实缴存排期；保留原收入模式，不引入北京估算，社保资料步仍仅在北京且缺项时出现。普通国家养老金卡与 Q4 仍仅在选北京时显示缴费步骤。预览另有 `plan-pension=transfer-excluded|transfer-manual`，对应生产处理器自动化已覆盖。

### Excel 导入与导出

当前源码使用 `.xlsx` 工作簿，外部 CSV 入口已替换；内部金融纯解析契约保留。`src-tauri/tests/spreadsheet.rs` 使用临时目录与虚构数据验证物品／账户／完整盘点／收入往返、未知与零、中文／前导零／字面公式文本、多行备注定位、同批回执重放、重启与完整备份，以及公式／异常 ZIP／稀疏范围拒绝、失败不覆盖目标。schema 25→35 升级保留事实与稳定 ID，Excel 改动不新增迁移。浏览器展示及自动测试不代表原生系统文件面板或其他表格软件交互已验。
