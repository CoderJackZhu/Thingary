// 虚构夹具：固定日期与金额，绝不来自真实资料库。隐私夹具故意包含可检索金额、
// 带金额的标题、姓名/账号式字符串与派生比例，供脱敏断言与预览对照使用。
import type { ReportInputV1, SeriesPoint } from './model.ts';

/** 预览与夹具统一使用的虚构“今天”。 */
export const FIXTURE_TODAY = '2026-10-07';

const projected = (date: string, available: string, restricted: string | null, debt: string | null): SeriesPoint => ({
  date, kind: 'projected',
  available: { kind: 'money', cents: available, basis: 'estimated' },
  restricted: restricted === null ? null : { kind: 'money', cents: restricted, basis: 'estimated' },
  debt: debt === null ? null : { kind: 'money', cents: debt, basis: 'estimated' },
});
const actual = (date: string, available: string, restricted: string | null, debt: string | null): SeriesPoint => ({
  date, kind: 'actual',
  available: { kind: 'money', cents: available, basis: 'known' },
  restricted: restricted === null ? null : { kind: 'money', cents: restricted, basis: 'known' },
  debt: debt === null ? null : { kind: 'money', cents: debt, basis: 'known' },
});

/** 当前方案 · 完整：敏感值 —— 标题含姓名+金额、账户名含银行+账号、比例 45.00%、图表金额。 */
export const currentReport: ReportInputV1 = {
  contract_version: 1,
  kind: 'current',
  status: 'complete',
  subject_name: '张三的100万退休方案',
  other_name: null,
  generated_on: '2026-10-07',
  source_date: '2026-09-30',
  monetary_basis_date: '2026-09-30',
  scenario_revision: 3,
  model_version: 'planning/2026.09',
  headline: { status: 'ok', amount: { kind: 'money', cents: null, basis: 'unknown' }, date: '2056-09-30' },
  next_step: { label: '确认未来每月净投入', detail: '张三工资到账后核对' },
  funds: [
    { id: 'f1', name: '招商银行活期 8888', availability: 'available', amount: { kind: 'money', cents: '100000000', basis: 'known' }, note: '工资卡（张三）' },
    { id: 'f2', name: '公积金账户', availability: 'restricted', amount: { kind: 'money', cents: '45000000', basis: 'estimated' }, note: null },
    { id: 'f3', name: '中国银行房贷', availability: 'debt', amount: { kind: 'money', cents: '-23000000', basis: 'known' }, note: '剩余本金' },
  ],
  goals: [
    {
      id: 'g1', name: '55岁退休（张三）', template: 'retirement', date: '2041-09-30', result: 'ok',
      amount: { kind: 'money', cents: null, basis: 'unknown' }, ratio: null, note: null, missing: [],
    },
    {
      id: 'g2', name: '安全底线 ¥300,000', template: 'milestone', date: '2028-03-31', result: 'incomplete',
      amount: { kind: 'money', cents: '30000000', basis: 'known' },
      ratio: { kind: 'ratio', hundredths: 4500 }, note: '包含装修预算 ¥150,000', missing: ['未来净投入未确认'],
    },
  ],
  assumptions: [
    { id: 'a1', label: '起点可用资金', value: { kind: 'money', cents: '100000000', basis: 'known' }, source: 'confirmed', confirmed_on: '2026-09-30' },
    { id: 'a2', label: '未来每月净投入', value: { kind: 'unknown' }, source: 'unknown', confirmed_on: null },
    { id: 'a3', label: '通胀率', value: { kind: 'ratio', hundredths: 200 }, source: 'estimated', confirmed_on: '2026-09-01' },
    { id: 'a4', label: '预测时段', value: { kind: 'text', text: '停止工作后 30 年' }, source: 'confirmed', confirmed_on: '2026-09-30' },
    { id: 'a5', label: '金额基准', value: { kind: 'date', date: '2026-09-30' }, source: 'confirmed', confirmed_on: '2026-09-30' },
    { id: 'a6', label: '投资估值波动', value: { kind: 'unknown' }, source: 'excluded', confirmed_on: null },
  ],
  series: [
    actual('2026-06-30', '96000000', '44000000', '-23500000'),
    projected('2026-09-30', '100000000', '45000000', '-23000000'),
    actual('2026-09-30', '100000000', '45000000', '-23000000'),
    projected('2026-12-31', '103000000', '46000000', '-22500000'),
    projected('2027-03-31', '106200000', '47000000', '-22000000'),
    projected('2027-06-30', '109500000', '48000000', '-21500000'),
    { date: '2026-09-30', kind: 'reference', available: { kind: 'money', cents: '99000000', basis: 'estimated' }, restricted: null, debt: null },
    { date: '2027-06-30', kind: 'reference', available: { kind: 'money', cents: '108000000', basis: 'estimated' }, restricted: null, debt: null },
  ],
  differences: [],
  missing: [
    { id: 'm1', label: '未来每月净投入未确认', impact: 'degrades', hint: '在方案中确认后可得出底线达成结论' },
  ],
};

/** 历史基准 · 不完整（partial）：未知金额保留，实际点稀疏且含月中盘点，缺项阻塞主结论。 */
export const baselineReport: ReportInputV1 = {
  contract_version: 1,
  kind: 'baseline',
  status: 'partial',
  subject_name: '基准：2026 年初采纳（张三）',
  other_name: null,
  generated_on: '2026-10-07',
  source_date: '2026-01-31',
  monetary_basis_date: '2026-01-31',
  scenario_revision: 1,
  model_version: 'planning/2026.01',
  headline: { status: 'incomplete', amount: { kind: 'money', cents: null, basis: 'unknown' }, date: null },
  next_step: { label: '先补齐冻结时的未知关键输入', detail: null },
  funds: [
    { id: 'f1', name: '招商银行活期 8888', availability: 'available', amount: { kind: 'money', cents: '88000000', basis: 'known' }, note: null },
    { id: 'f2', name: '未知投资账户', availability: 'available', amount: { kind: 'money', cents: null, basis: 'unknown' }, note: '冻结时未盘点' },
    { id: 'f3', name: '中国银行房贷', availability: 'debt', amount: { kind: 'money', cents: '-24000000', basis: 'known' }, note: null },
  ],
  goals: [
    {
      id: 'g1', name: '55岁退休（张三）', template: 'retirement', date: '2041-01-31', result: 'incomplete',
      amount: { kind: 'money', cents: null, basis: 'unknown' }, ratio: null, note: null, missing: ['部分账户金额冻结时未知'],
    },
  ],
  assumptions: [
    { id: 'a1', label: '起点可用资金', value: { kind: 'money', cents: null, basis: 'unknown' }, source: 'unknown', confirmed_on: null },
    { id: 'a2', label: '通胀率', value: { kind: 'ratio', hundredths: 250 }, source: 'estimated', confirmed_on: '2026-01-31' },
  ],
  series: [
    projected('2026-01-31', '88000000', null, '-24000000'),
    projected('2026-04-30', '90500000', null, '-23700000'),
    projected('2026-07-31', '93100000', null, '-23400000'),
    actual('2026-08-15', '92500000', null, '-23350000'),
    projected('2026-10-31', '95800000', null, '-23100000'),
  ],
  differences: [],
  missing: [
    { id: 'm1', label: '冻结时部分账户金额未知', impact: 'blocks_headline', hint: '基准只冻结当时可计算的指标，不能用 0 补齐' },
    { id: 'm2', label: '2026-08-15 盘点在月中', impact: 'info', hint: '实际点与当月预计对照，非精确当天预测' },
  ],
};

/** 方案比较 · 完整：对方名称含恶意 HTML 与姓名，差异含自由依据文本；差额 null 表示不可比。 */
export const comparisonReport: ReportInputV1 = {
  contract_version: 1,
  kind: 'comparison',
  status: 'complete',
  subject_name: '张三的100万退休方案',
  other_name: '李四的保守方案 <img src=x onerror=alert(1)>',
  generated_on: '2026-10-07',
  source_date: '2026-09-30',
  monetary_basis_date: '2026-09-30',
  scenario_revision: 3,
  model_version: 'planning/2026.09',
  headline: { status: 'shortfall', amount: { kind: 'money', cents: '12000000', basis: 'estimated' }, date: '2052-03-31' },
  next_step: { label: '选择要采用的方案', detail: '与李四确认后再采用' },
  funds: [
    { id: 'f1', name: '招商银行活期 8888', availability: 'available', amount: { kind: 'money', cents: '100000000', basis: 'known' }, note: null },
  ],
  goals: [
    {
      id: 'g1', name: '55岁退休（张三）', template: 'retirement', date: '2041-09-30', result: 'shortfall',
      amount: { kind: 'money', cents: '12000000', basis: 'estimated' }, ratio: { kind: 'ratio', hundredths: 8720 }, note: null, missing: [],
    },
  ],
  assumptions: [
    { id: 'a1', label: '起点可用资金', value: { kind: 'money', cents: '100000000', basis: 'known' }, source: 'confirmed', confirmed_on: '2026-09-30' },
  ],
  series: [
    actual('2026-09-30', '100000000', null, null),
    projected('2027-09-30', '112000000', null, null),
    projected('2028-09-30', '124500000', null, null),
    { date: '2027-09-30', kind: 'reference', available: { kind: 'money', cents: '108000000', basis: 'estimated' }, restricted: null, debt: null },
    { date: '2028-09-30', kind: 'reference', available: { kind: 'money', cents: '116000000', basis: 'estimated' }, restricted: null, debt: null },
  ],
  differences: [
    {
      id: 'd1', label: '未来每月净投入',
      current: { kind: 'money', cents: '800000', basis: 'estimated' },
      other: { kind: 'money', cents: '500000', basis: 'estimated' },
      delta: { kind: 'money', cents: '300000', basis: 'estimated' },
      note: '李四希望降低月供压力',
    },
    {
      id: 'd2', label: '预测终点',
      current: { kind: 'date', date: '2056-09-30' },
      other: { kind: 'date', date: '2051-09-30' },
      delta: null, note: null,
    },
    {
      id: 'd3', label: '通胀率',
      current: { kind: 'ratio', hundredths: 200 },
      other: { kind: 'ratio', hundredths: 250 },
      delta: null, note: null,
    },
  ],
  missing: [],
};

export const fixtures = { current: currentReport, baseline: baselineReport, comparison: comparisonReport } as const;
export type FixtureKey = keyof typeof fixtures;
