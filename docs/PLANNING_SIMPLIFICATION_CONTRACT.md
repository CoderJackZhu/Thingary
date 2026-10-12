# 简化规划与投资复盘：并行组件接口 v1

状态：**第一批通用规划已接入，第二批投资复盘沿此契约接入存储与主页面。** 产品范围以 [PRODUCT_BOUNDARIES_DESIGN](PRODUCT_BOUNDARIES_DESIGN.md) 为准。本文件仅维护组件边界、字段和行为，不预占 IPC 名称、数据库表名或 schema。修改本接口必须由集成负责人统一更新版本、样例与消费者；不能由某个并行分支自行改名。

## 1. 交付边界

领域实现负责校验、持久化、旧政策数据删除、通用计算和结果；界面组件只处理未保存草稿与交互，通过注入端口读取／保存，不直接猜测 Rust 命令。投资复盘展示组件保留在独立目录，通过宿主接入真实 Store 与主页面；收入分类、导入和备份由领域模块维护，不放进展示组件。

旧产品代码在隔离开发阶段可能仍存在，不能把它当成新产品的兼容要求。只有联调后旧政策路径、字段和运行依赖全部退出、客观事实保全，才算第一批完成；组件或接口完成不是产品交付。

## 2. 共用值与规划输入

以下 TypeScript 表达跨语言逻辑 DTO；所有字段显式存在，未知用 null，不用空字符串、undefined 或 0 替代。日期／月份仍由领域校验，字符串类型不表示任意文本合法。分金额采用十进制整数字符串，校验边界沿用当前应用，不静默放宽；不能用 Number 累加事实金额。

```ts
type Month = string; // YYYY-MM
type DateOnly = string; // YYYY-MM-DD
type Cents = string; // canonical integer cents; input amounts are nonnegative

type TimeInputV1 = {
  reference: null | { month: Month; age_months: number };
  target_month: Month | null;
  horizon_month: Month | null;
};

type FutureIncomeV1 = {
  id: string;
  name: string;
  role: 'pension' | 'other';
  included: boolean;
  monthly_cents: Cents | null;
  start_month: Month | null;
  end_month: Month | null; // null = through plan horizon
  basis: 'reference_month' | 'start_month';
  basis_month: Month | null; // required for reference_month; null for start_month
  growth: 'fixed_nominal' | 'constant_purchasing_power';
  source: string | null;
  source_checked_on: DateOnly | null;
  notes: string;
};

type SimplifiedPlanningFieldsV1 = {
  contract_version: 1;
  time: TimeInputV1;
  income_mode: 'unconfirmed' | 'excluded' | 'manual';
  future_incomes: FutureIncomeV1[];
};
```

此分区不复制已有资金、完整预算、净投入、费用、实际发生或余债。首次四问保存由领域适配器将此分区与既有 setup 草稿一次提交；不能先存新收入，再单独存其他三问。普通单项编辑只更新其授权分区。

`income_mode=excluded` 表示用户明确本次不计入；`unconfirmed` 表示尚未选择，不允许给完整规划结论。`manual` 下可保存不完整收入，但需明确未计入该项。`included=false` 只排除预测，不删除记录。姓名／身份、出生年月、性别、职工类型、地区、缴费基数和排期不在新 DTO 中，也不能从隐藏旧字段补取。

年龄仅用于用户新确认后的输入换算。最终 target/start/end/horizon 使用明确月份；reference 为 null 时完整年月模式仍可用。修改年龄参考不能默默改变已有月份。计入区间含开始月与结束月，到账按月底；首月部分期沿当前月账本规则。

`basis=start_month` 的金额以首次领取月为价格基准；`reference_month` 的金额基准固定为用户确认月份，不随今天移动。增长与金额基准是两个独立概念，公式以产品设计 §12.2 为准。开始时间未知时不能以目标月替代。原始金额持久化，折算结果不回写。

## 3. 界面端口与保存状态

领域方提供适配器，界面方消费；适配器内部复用既有 generation、revision、请求回执和提交未知机制，不另建第二套保存。

```ts
type FieldIssueV1 = { path: string; code: string; message: string };
type SaveContextV1 = {
  request_id: string;
  generation: string;
  expected_revision: number | null;
};
type SaveOutcomeV1 =
  | { status: 'saved'; revision: number }
  | { status: 'rejected'; issues: FieldIssueV1[] }
  | { status: 'unresolved'; request_id: string };

type SimplifiedPlanningEditorPropsV1 = {
  initial: SimplifiedPlanningFieldsV1;
  issues: FieldIssueV1[];
  busy: boolean;
  unresolved: boolean;
  onDraftChange: (fields: SimplifiedPlanningFieldsV1) => void;
  onSubmit: (fields: SimplifiedPlanningFieldsV1) => void;
  onCancel: () => void;
  onOpenOfficial: () => void;
};
```

组件不自行生成与重放提交；request_id 与保存上下文由调用方统一拥有。`onSubmit` 表示提交意图，不能立即关闭：收到 saved 后才由父级关闭／刷新。rejected 保留草稿并定位字段，unresolved 冻结重复提交并提供既有回执核对。Q4 子编辑器只调用 onDraftChange，由父向导统一保存。

推荐字段路径如 `time.target_month`、`future_incomes.<id>.monthly_cents`；使用稳定收入 ID，不使用会因排序变化的数组索引。业务错误不得以“全部资料为空”替代。

旧计划的重设原因最少区分 `time_unconfirmed`、`income_unconfirmed`、`funds_unconfirmed`，并与读取错误分开。已有 `buildBasicCapabilities` 结果结构由领域所有者统一适配，UI 不定义第二套需求／模拟结果。未接真实能力时只展示标为虚构的输入与结果夹具，不伪装实时计算。

## 4. 投资复盘输入与输出

```ts
type InvestmentScopeMemberV1 = {
  account_id: string;
  kind: string; // supported: investment | mixed | fund | bond
  counted: boolean;
  amount_cents: Cents | null;
};
type InvestmentEndpointV1 = {
  snapshot_id: string;
  revision: number;
  date: DateOnly;
  members: InvestmentScopeMemberV1[];
};
type InvestmentFlowV1 = {
  id: string;
  revision: number;
  from_snapshot_id: string;
  from_revision: number;
  from_value_key: string;
  to_snapshot_id: string;
  to_revision: number;
  to_value_key: string;
  from_date: DateOnly;
  to_date: DateOnly;
  scope_account_ids: string[];
  inflow_cents: Cents | null;
  outflow_cents: Cents | null;
  confirmed_complete: boolean;
  unsupported_movements: boolean;
  notes: string;
};
type InvestmentReviewInputV1 = {
  contract_version: 1;
  from: InvestmentEndpointV1;
  to: InvestmentEndpointV1;
  flow: InvestmentFlowV1 | null;
  overlapping_active_flow_ids: string[];
};
type InvestmentReviewValueV1 = {
  opening_cents: Cents;
  closing_cents: Cents;
  change_cents: Cents; // signed
  inflow_cents: Cents;
  outflow_cents: Cents;
  profit_cents: Cents; // signed; includes reflected income and costs
};
type InvestmentReviewResultV1 =
  | { status: 'ready'; value: InvestmentReviewValueV1 }
  | { status: 'not_recorded' | 'needs_review' | 'not_comparable';
      reasons: string[]; change_cents: Cents | null }
  | { status: 'invalid'; issues: FieldIssueV1[] };
```

endpoint 由事实适配器挑选同一投资范围，核心仍复核唯一 ID、合法类型／金额、counted、日期顺序和两端相同集合。空范围返回 not_comparable，不计算“投资收益 0”。成员顺序不影响结果；重复 ID 是 invalid。暂不支持的账户类型不得仅因 caller 传入就参与公式。

核心只处理成功读取的事实：读取失败、模块关闭在端口外层显式显示，不传入空集合假装没有投资。优先级：非法载荷 → 不可比较 → 引用／区间确认失效 → 未记录／不完整 → ready。`change_cents` 只有两端可比且金额齐全时存在，与流动是否齐全独立。

缺 flow 返回 not_recorded；金额未知或未确认完整返回 needs_review。流动引用的 ID／日期／计算内容／范围不一致、活动汇总重叠或有未支持的证券／杠杆流动，均不得 ready。理由稳定使用 `missing_flow`、`incomplete_flow`、`stale_endpoints`、`scope_changed`、`missing_balance`、`overlapping_flow`、`unsupported_movement`、`empty_scope`，不靠解析中文文案判断状态。

`from_value_key`／`to_value_key` 保存确认当时的计算内容键：紧凑 JSON 数组 `[snapshot_id,date,[[account_id,kind,counted,amount_cents],...]]`，成员按稳定 account_id 升序，保留 null。由领域函数生成及复核，UI 不拼接；不是用户填写项。修订号仍用于审计与保存冲突，不能单凭修订号变化撤销确认。备注等非计算字段不进入内容键，金额、日期、范围和类型更正会改变内容键。

`confirmed_complete=true` 而金额为空是 invalid；0 必须显式提供。候选范围与无效金额校验不能在 UI 省略后端验证。计算式为期末 − 期初 − 流入 + 流出，事实与计算采用整数分，负损益允许。分红明细不进入该公式的第二次加总，单期结果也不输出百分比。

投资 UI 只接收 Input/Result 与 onDraftChange/onSubmit/onCancel 等注入端口；持久化和重叠查询由 Store 适配负责。新汇总 draft 不需要真实保存 ID，提交时由 Store 建立；不得让 UI 为还未保存的汇总伪造 revision。

## 5. 共用验收夹具与修改规则

规划最少覆盖：新年月模式、年龄重新确认、旧资料待重设、明确不计、收入缺金额／时间、固定名义／保持购买力、已有领取和结束月、保存拒绝／提交未知。投资最少覆盖产品设计 §13.5，另加重复 ID、未知余额、空范围、端点过期、交叠、已确认但金额为空与输入顺序变化。

领域输出样例由其所有者维护，UI 夹具遵守相同 DTO；UI 不把需求值复制成预计投入。结果 payload、货币基准、开始／结束月、字段可空性一旦改动必须更新本文件和双方夹具，不能仅在一个分支做适配。

第一批运行时 v1 与第二批投资 v1 是独立接口，不要求同一数据库迁移。本文件的版本也不等于应用版本、BasicInputs 旧 contract_version 或 schema；实际替换必须显式转换，不能因都叫 v1 而混用旧载荷。
