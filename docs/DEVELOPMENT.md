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

### 规划核算与实际发生预览

在独立开发树运行 `npm run dev -- --port 1429`，访问 `http://127.0.0.1:1429/visual-preview.html?section=planning&plan-basic=saved&capabilities=real&plan-core=confirmed`。`plan-core=occurred` 展示虚构已吸收首付／余债接续；`partial` 展示部分付款缺项；`overdue` 展示逾期待核对。去掉 `plan-basic` 可核对无通用输入时待重新设置；`state=empty`、`plan=error` 与 `state=save-error` 检查空、读取失败和保存失败。全部是内存夹具，刷新重置，不代表原生或持久化验收。

`tests/planning-core.test.mjs` 覆盖资产事实、分池、已含费用、余债与首月顺序。

关联订阅生命周期（组删除／恢复、共享保存双方修订、预览失效、历史归组与备份往返）在 `src-tauri/tests/link_groups.rs` 对临时 Store 验证（旧订阅合并发现在 `src-tauri/tests/link_merge.rs`）；其中 schema32→33 矩阵覆盖主分支的无组表版本与未发布订阅分支的完整组表版本，检查升级、旧备份恢复、规划载荷与稳定 ID 保持、非法结构拒绝及事务回滚。重要支出年度桶的固定金额样例在 `src-tauri/tests/expenses.rs`（`annual_buckets_match_design_example`），前端桶口径在 `tests/expense-annual.test.mjs`。`src-tauri/tests/plan_profile.rs` 对真实临时 Store 测试 core 保存、修订冲突、提交后回执丢失重放、重启、备份恢复、引用更正和 schema30→31 回滚。不得对正式资料库运行。

### 金融导入解析与报告组件

金融 CSV 解析器的契约、虚构样例和待接入边界见[解析器说明](../src-tauri/src/financial_import_parser/README.md)，回归位于 `src-tauri/tests/financial_import_parser.rs`，由 `npm test` 执行。它不写入数据库。

运行 `npm run dev -- --port 1431`，访问 `http://127.0.0.1:1431/planning-report-preview.html` 查看[只读报告组件](../src/planning-report/README.md)的虚构状态与隐私输出；`tests/planning-report.test.mjs` 由 `npm run test:ui` 执行。预览不进入正常发布构建；真实报告适配、产品入口及原生 PDF／文件对话框尚未接入。

### 职业变化情景原型

运行 `npm run dev -- --port 1438`，访问 `http://127.0.0.1:1438/career-preview.html`。页面默认关闭试算，打开后使用虚构资料比较空窗长度、恢复后净投入或退休预算；`?state=pension|unknown|empty|error|shortfall` 可加载恢复未知、无资料、读取失败和月内付款不足状态。刷新或关闭丢弃修改，不调用原生服务、不写存储，也不进入普通应用导航和正常发布构建。

`tests/plan-career.test.mjs` 覆盖真实来源形态的编译、阶段费用去重、缴费对未来资格／受限池的影响、付款先后、能力缺项、固定目标反求边界和单项对照。预览默认是无养老金的简化虚构样例，`?state=pension` 加载计入北京养老金的虚构缴费史；打开试算后按三个问题进入（保持退休目标最长可空窗多久、再做多久可以降低投入、换工作后每月至少要攒多少），另有窗口地图、最长空窗、推迟退休让步、空窗期补偿金与限期补助、窗口内的大额一次性收入、社保方案对比与养老金资格缺口（`plan-career-map.ts`，`tests/plan-career-map.test.mjs`）。贷款联动由领域测试覆盖，尚无对应交互表单。实施和后续门槛见[职业变化情景契约](CAREER_SCENARIO_DESIGN.md)。已收到首轮用途反馈，完整用途观察、正式入口和原生验收尚未完成。

浏览器已检查三项对照、未知／空／读取失败／非法输入／月内不足、关闭重置，以及月份选择器方向键、Escape 焦点返回和 Tab 顺序。已补齐 1280 与 420 像素状态截图、420 像素六种外观及同尺寸修改前后对照，并完成视觉审阅。Ego 截图不稳定时使用全新隔离 Chrome 会话补验，只允许访问本地虚构预览；C11 浏览器范围已完成，不代表原生或 VoiceOver 已验。恢复投入对照优先显示目标资金差额，避免把“不变的目标要求”误读成“投入降低没有影响”；结果链接支持键盘跳转和焦点到达。

职业预览的缴费条件初始待确认。社保区先选时间段与交法，自己交时只填一份每月实际缴费；按下限或原基数不显示自定义输入。主表单直接重算，只显示缴费摘要并提供另一阶段的填写入口；三个问题的答案统一位于全部输入之后的唯一结果区，链接可直接跳转；单位缴纳按个人部分已从工资扣除处理，停缴明确本项费用为 0，额外医保计入总开销。其他交法的只读比较移至结果区、默认折叠，标明固定空窗长度，不改变主条件。问题切换保留，更换样例或关闭重置。计算边界回归见 `tests/plan-career-map.test.mjs`。

已补验单次金额输入、修改／清空、基数按需显示和非法阻断、阶段跳转、三问题答案一致、比较不改变主值、关闭重置；审阅 1280 像素同尺寸前后对照，及 420 像素三外观浅深模式、空白／错误状态。Ego 完成交互核验，截图接口超时后由独立 Playwright 会话补齐视觉。原生、VoiceOver 与完整用途验证仍后置。

独立核算用例运行 `node --test tests/plan-career-reference.test.mjs`，并包含在 `test:ui` 中。预期值由不导入生产引擎的测试账表逐月计算，适用范围及未验证项见[独立核算边界](CAREER_SCENARIO_DESIGN.md#唯一结果与独立核算)。结果区新增储蓄减少／开销增加的单项对照，变化幅度可改；缺项不产生数值答案。测试通过不等于现实预测有效，外部计算器同口径比对与北京法定待遇专项核验仍待完成。

唯一结果区已检查三个问题切换、主答案不重复、储蓄／缴费清空撤销数值、条件变化不写回、结果链接的 Enter 焦点到达及关闭重置；保留 1280×1000 与 420×900 同条件前后截图，覆盖正常、未知、空白与读取错误。原生与 VoiceOver 未验。

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

`tests/planning-basic-ui.test.mjs`、`planning-basic-service-integration.test.mjs` 和 `planning-basic-consumers-integration.test.mjs` 覆盖四步设置、未知／零／负数、草稿无副作用和原回执防覆盖。Rust `src-tauri/tests/planning_basic.rs` 覆盖旧资料只读适配、事实与稳定ID保全、旧备份恢复、旧回执重放及完整保存事务；`plan_profile.rs` 覆盖付款、吸收关系、余债与来源引用。旧阶段／路线夹具应显示「待重新设置」，目标／预算／投入不得自动带入。浏览器覆盖正常、未知、空白和错误状态，同尺寸比较新旧入口；截图或原生功能未完成时记录限制。原生使用独立身份，数据必须虚构。


## 通用规划基础联合验收

第一批将真实 `buildBasicCapabilities` 绑定到基础界面，引导通过只读内存分区叠加预览，最终setup一次事务保存；收入明细、资金规则和养老字段不能分次留下半成品。`tests/planning-basic-service-integration.test.mjs`、`planning-basic-consumers-integration.test.mjs` 与 `planning-basic-ledger-integration.test.mjs` 覆盖真实provider、来源同批、未知／临时隔离、费用作用域、受限池一次解锁、原回执防覆盖；Rustplanning_basic覆盖引导完整保存、失败回滚、重放和独立养老金。Worker覆盖仅保存规划后重启仍进入个人库。

浏览器 `?section=planning&plan-basic=unknown&capabilities=real` 使用虚构来源和真实纯计算；不加capabilities参数的异常状态仍为展示夹具，不能当数值验收。原生使用独立bundle标识 `local.thingary.basic.acceptance.20261007`，实测新建模拟起点、添加手填退休收入、保存后投入保持null、目标／首页需求一致、重启恢复。未完成全套原生VoiceOver、真实中文输入法组合及三主题全窗口矩阵；浏览器证据不替代这些范围。未访问正式库，不代表正式包已安装或公开发布。

## 固定当前收支工具与收益对照

运行`npm run test:ui`覆盖`plan-runway.test.mjs`及`planning-basic-consumers-integration.test.mjs`。重点核对空白不等于零、月初支付／月底到账、现金流持平仍可能触底、无法支付时仍有余额、所选检查期、无目标手填入口和临时输入不写入。基础风险页只构建六个通用压力条件；无旧职业估算路径，但完整预算及零终点说明与计算一致。收益升／降200 bps均局部反求，越界不计算，也不回写预计投入。界面验收只用隔离身份和虚构资料，记录原生与浏览器证据；VoiceOver／真实中文输入法及完整主题窗口矩阵不能由自动检查推定通过。

### 规划源码来源回归

第三方告知见 [SOURCE_NOTICES](../SOURCE_NOTICES.md)。`tests/source-provenance.test.mjs` 只保存已移除上游文案的长度和散列，防止完整值重新出现，不将通过散列检查当作许可认证。`tests/plan-risk.test.mjs` 验证零波动与同一月账本一致、月初资金缺口不能由随后解锁掩盖、规划终点恰好为零的成功口径，以及无提款时相同年度收益排列的终点余额一致（含不足一年的终点）。打包告知除包管理器依赖外还收集根目录 `SOURCE_NOTICES.md`；生成器不会自动判定新内置内容的授权，新增来源须同步登记。


基础规划的操作层可用 `?section=planning&plan-basic=beijing-complete` 查看四步设置与未来缴费月份；`plan-basic=blank|unknown|negative|saved` 分别检查空白、预计投入未知、负值与已保存。`state=save-error` 检查保存失败保留输入。`section=virtual` 的虚构创作服务可查看关联订阅的结束确认窗；`section=expenses` 检查年度柱图进入月度回顾及金额待补提示。合并共用控件时，`tests/cent-input-interactions.test.mjs` 验证真实输入处理保持负整数分、零、未知与字段说明关联。
