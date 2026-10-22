// 简化规划界面的纯展示与草稿辅助逻辑。类型的唯一来源是领域 D0 契约
import { numberLocale } from '../i18n.ts';
// （../plan-simplified-contract.ts）；这里不复制第二份模型，也不做业务校验，
// 保存前的校验统一走领域 validateSimplifiedPlanningV1。
import type { FieldIssueV1, FutureIncomeV1, ResetReasonV1, SimplifiedPlanningFieldsV1, TimeInputV1 } from '../plan-simplified-contract.ts';
import { monthIndexV1, validMonthV1 } from '../plan-simplified.ts';

/** 官方工具入口（产品边界设计 §4.2）。仅链接，不内嵌、不代填、不承诺结果精确。 */
export const OFFICIAL_TOOL = { name: '国家社会保险公共服务平台', url: 'https://si.12333.gov.cn/' } as const;
export const OFFICIAL_TOOL_NOTE = '进入官方平台查找相关测算服务；部分服务可能需要登录或填写资料，具体入口与说明以平台为准。';

export const yuanText = (cents: string | null): string =>
  cents === null ? '未填金额' : `${(Number(cents) / 100).toLocaleString(numberLocale(), { maximumFractionDigits: 2 })} 元`;

export const startText = (i: FutureIncomeV1): string => (i.start_month === null ? '开始时间未填' : `${i.start_month} 起`);
export const endText = (i: FutureIncomeV1): string => (i.end_month === null ? '持续到规划终点' : `${i.end_month} 止`);

/** 默认口径必须常显（设计 §10.3）：不能藏着把官方未来名义金额当今天的购买力。 */
export function basisSentence(i: FutureIncomeV1): string {
  const base = i.basis === 'start_month' ? '按开始领取时的金额' : i.basis_month === null ? '按所选月份的购买力' : `按 ${i.basis_month} 的购买力填写`;
  const growth = i.growth === 'fixed_nominal' ? '此后金额不自动增长' : '此后保持同样购买力';
  return `${base}；${growth}。`;
}

export type IncomeState = 'counted' | 'missing_amount' | 'missing_start' | 'excluded';
export function incomeState(i: FutureIncomeV1): IncomeState {
  if (!i.included) return 'excluded';
  if (i.monthly_cents === null) return 'missing_amount';
  if (i.start_month === null) return 'missing_start';
  return 'counted';
}
export const incomeStateText: Record<IncomeState, string> = {
  counted: '已计入',
  missing_amount: '未计入：金额未填',
  missing_start: '未计入：开始时间未填',
  excluded: '本次不计入',
};

/** 未计入项目说明：未知不装成 0，也不冒充完整结论（设计 §4.2）。 */
export function excludedIncomeNote(fields: SimplifiedPlanningFieldsV1): string | null {
  const parts = fields.future_incomes.filter(i => incomeState(i) !== 'counted');
  if (!parts.length || fields.income_mode === 'excluded') return null;
  return `未计入：${parts.map(i => `${i.name}（${incomeStateText[incomeState(i)]}）`).join('、')}。结果不包含这些收入。`;
}

/** 新增养老金默认「开始领取时的名义金额、此后固定名义金额」（设计 §10.3）；普通收入沿用同一组选项。 */
export function newIncome(role: FutureIncomeV1['role'], id: string = crypto.randomUUID()): FutureIncomeV1 {
  return { id, name: role === 'pension' ? '养老金' : '', role, included: true, monthly_cents: null, start_month: null, end_month: null,
    basis: 'start_month', basis_month: null, growth: 'fixed_nominal', source: null, source_checked_on: null, notes: '' };
}

/** 旧政策退出的重设原因（契约 §3），与读取错误分开表达。 */
export function resetReasonText(reasons: ResetReasonV1[]): string {
  if (!reasons.length) return '';
  const names: Record<ResetReasonV1, string> = { time_unconfirmed: '开始时间', income_unconfirmed: '未来收入', funds_unconfirmed: '可用资金' };
  return `规划条件已简化，请重新确认${reasons.map(r => names[r]).join('和')}。物品、账户和盘点资料不受影响。`;
}

export function issuesFor(issues: FieldIssueV1[], prefix: string): FieldIssueV1[] {
  return issues.filter(i => i.path === prefix || i.path.startsWith(prefix + '.'));
}

/** 同名项允许存在，靠稳定 ID 区分；保存前提示核对，不按名字或金额自动合并（设计 §10.3）。 */
export function duplicateNameIds(fields: SimplifiedPlanningFieldsV1): string[] {
  const seen = new Map<string, string[]>();
  for (const i of fields.future_incomes) {
    const key = i.name.trim();
    if (!key) continue;
    seen.set(key, [...(seen.get(key) ?? []), i.id]);
  }
  return [...seen.values()].filter(ids => ids.length > 1).flat();
}

/** 年龄文本辅助：把「36 岁 4 个月」这类输入折算成整月。 */
export function ageMonthsOf(years: string, extraMonths: string): number | null {
  const y = years.trim(), m = extraMonths.trim();
  if (y === '' && m === '') return null;
  if (!/^\d{1,3}$/.test(y) || (m !== '' && !/^(10|11|[0-9])$/.test(m))) return null;
  const total = Number(y) * 12 + (m === '' ? 0 : Number(m));
  return total >= 0 && total <= 1440 ? total : null;
}

export function ageText(months: number): string {
  const y = Math.floor(months / 12), m = months % 12;
  return m === 0 ? `${y} 岁` : `${y} 岁 ${m} 个月`;
}

export function ageAtMonth(reference: TimeInputV1['reference'], month: string | null): number | null {
  if (!reference || !validMonthV1(reference.month) || !validMonthV1(month)) return null;
  const age = reference.age_months + monthIndexV1(month) - monthIndexV1(reference.month);
  return Number.isInteger(age) && age >= 0 && age <= 1440 ? age : null;
}

/** 时间草稿的可读摘要（用于结果侧固定清单）。 */
export function timeSummary(time: TimeInputV1): string {
  const targetAge = ageAtMonth(time.reference, time.target_month), horizonAge = ageAtMonth(time.reference, time.horizon_month);
  const target = targetAge === null ? time.target_month ?? '未选' : `${ageText(targetAge)}（${time.target_month}）`;
  const horizon = horizonAge === null ? time.horizon_month ?? '未选' : `${ageText(horizonAge)}（${time.horizon_month}）`;
  return `从 ${target} 开始安排，规划到 ${horizon}。`;
}
