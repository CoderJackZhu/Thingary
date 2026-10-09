# 规划基础、导入与报告的组件契约

状态：**配合已批准范围的工程细化，待实现与集成。** 基线为 `7eaff7c612e51875cdc9f299ecef2951abfd8f87`。总体行为和数据语义以 [总设计](PLANNING_LIFECYCLE_DESIGN.md)及其专项规格为准。此文件规定可独立开发的组件边界，不登记某轮执行状态，不预占数据库/IPC版本。

## 1. 三个边界

| 组件 | 输入与输出 | 可以独立交付 | 集成依赖 |
|---|---|---|---|
| 规划基础 | 已确认资金/阶段/事件 → 联合时间线与缺项 | 纯计算、现实接续、最小持久化、现有调用方适配 | 统一事实与方案由该组件拥有 |
| 金融导入解析 | UTF-8文件/列映射/已知账户目录 → 标准行/问题/重复候选 | 解析器、字段校验、文件内分组与错误定位 | 数据库重复、事务写入和回执接入规划基础后实施 |
| 复盘报告展示 | 只读报告 DTO → 可读视图/脱敏视图/可打印内容 | 确定性夹具、组件、打码、打印预览 | 实际基准读取与真实PDF原生接入依赖基础 |

独立组件不得自行创建另一套事实/方案存储或规划算法。夹具/预览必须明确虚构；组件完成不等于完整产品流程已交付。

## 2. 导入解析契约 v1

新增 Rust 模块建议为 `src-tauri/src/financial_import_parser.rs`，不依赖 Store、Worker 或 SQLite；输出类型派生 serde，命名可在模块内组织，序列化字段按本节固定。

输入 `ImportRequestV1`：`contract_version=1`、`kind`（accounts/snapshots/incomes/income_coverage/net_worth_history）、`csv_text`、`column_mapping`（源列名到模板列名）、`existing_accounts`（只读外部键/稳定ID/有效期/类型目录，可空）。文件字节/编码/大小在入口校验；模块仍按规格检查限制，不能执行内容。

输出 `ImportPreviewV1`：

- `contract_version=1`、`kind`、`rows`、`groups`、`issues`、`counts`。
- 标准行：`source_row`、`external_key`、该模板的规范字段；所有金额字段以 `*_cents` 十进制字符串或 null 表达；所有日期规范 `YYYY-MM-DD`。
- 盘点标准行：`snapshot_key`、`date`、`account_key`、`amount_cents`、`note`、可选历史类型/计入覆盖。
- 收入标准行：`income_key`、`date`、`net_income_cents`、`hpf_deposit_cents`、`note`；空缴存为 null，明确0为字符串 `"0"`。
- 问题：`code`、`severity`（error/warning）、`source_row`、`column`（可空）、`group_key`（可空）、`message`。
- 分组：`group_key`、`date`、`source_rows`、`validation`（valid/invalid/requires_account_context）。缺账户目录时不能声称跨数据库完整性已校验。
- 计数：读入行、有效行、错误行、有效/错误/待上下文组、文件内相同/冲突候选。计数定义不能把账户级行数当盘点次数。

解析失败仍返回可定位的 issues，不以空数组假装空文件。标准行是待提交数据，不是已写入事实。文件内重复与数据库已有记录重复分别处理；缺数据库上下文不返回“无重复”的保证。

校验码至少区分编码/格式、缺列、金额、日期、重复键、盘点重复账户、盘点组冲突、账户未映射、完整性待核对、超限。字符串消息可以改善，调用方使用 code 判定。

测试可在独立 integration test 中通过 `#[path = "../src/financial_import_parser.rs"]` 引用模块，避免为独立交付修改 lib/commands。集成时由拥有方登记模块与业务入口。

## 3. 报告展示契约 v1

新增前端目录建议为 `src/planning-report/`。组件输入只读 `ReportInputV1`，不能读取数据库或调用旧退休计算来补字段。

| 字段 | 契约 |
|---|---|
| contract_version | 1 |
| kind | current/baseline/comparison |
| generated_on、monetary_basis_date | 本地日期；缺项保留 null并标明 |
| source_date、scenario_revision、model_version | 来源元数据，不从当前日期猜 |
| status | complete/partial；读取失败是组件外单独状态 |
| headline | 语义状态 ok/shortfall/incomplete，金额使用结构化 money 值 |
| funds | 稳定局部ID、名称、可用性、金额/依据状态 |
| goals | ID、名称、模板类型、日期、结构化结果、缺项 |
| assumptions | 有标签的 text/date/money/ratio/unknown 值与来源状态 |
| series | 日期、预计/实际/参考种类、可用/受限资金及债务金额；缺值为null |
| differences、missing | 两方案差异或未覆盖项；不生成虚假因果解释 |

金额统一 `{ kind: 'money', cents: string | null, basis: 'known' | 'estimated' | 'unknown' }`；比例用 `{ kind: 'ratio', hundredths: number | null }`，百分比与金额打码同步隐藏。不要把金额先塞入不可控自由文本再尝试正则删数字。

自由标题/名称/备注可能包含敏感值。隐私报告使用局部别名、受控模板句；隐藏未结构化自由文本与金额派生比例，避免姓名或“100万方案”从标题漏出。完整报告字符串正常转义，不能执行任意HTML。

组件必须支持 loading/empty/error/partial/ready；完整与隐私输出都从同一快照生成。打印内容、可访问名称、复制文本、图表说明及文件元数据只接收对应脱敏载荷，不能把完整DTO嵌在隐藏DOM或script中。

独立开发预览可用根目录 `planning-report-preview.html` 和目录内 `preview.tsx`，固定虚构数据/日期，确认不进入正常发布入口。不改现有总览、主路由、共享金额格式器或组件预览来接入；产品入口由集成任务完成。

可打印HTML/浏览器打印预览是本组件可验范围；未做隔离原生打印/存PDF不得声称已完成真实原生PDF导出。

## 4. 兼容与交付要求

contract_version 在边界校验；未知版本返回明确错误，不默认按v1读取。协议金额不经过 Number 后再存回；绘图坐标转换不能成为财务结果来源。

独立测试使用相同口径的虚构例子。schema、备份、回执、commands、共享类型、主导航和现行规则由基础/集成拥有方调整，避免多个组件各自抢占。

交付注明：组件已验功能、尚未接入产品的功能、输入假设、接口版本、实际测试命令与结果。合并时先基础，后解析/展示，最后做真正数据库导入和基准报告接入，运行全套检查及隔离原生验收。

## 已有贷款直接还款安排

可选 retire.core.debt_repayments 与分区 DTO debt_repayments.fields={updates,remove}，不建表、不迁移。缺省未处理，空数组省略，旧请求序列化／指纹保留原字节；新请求含实际选择。复用修订、generation、未知回执及备份校验，冻结输出和历史回执不重写；含新字段数据不能被旧版读取。DEBT_UNLINKED 是未处理／不完整，DEBT_EXCLUDED 为不催办说明（actionable=false），DEBT_BALANCE_CHANGED 是不增加待办计数的复核提示。适用阶段按固定期限与退休区间判断，未知不补零。
