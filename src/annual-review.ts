import { money } from './asset.ts';
import { countsAsSpending } from './expenses.ts';
import { incomeMetric, expenseMetric } from './finance-review-model.ts';
import type { FinanceRead, FinanceSources } from './finance-service.ts';
import type { ReviewPeriodPreset } from './finance-period-control.ts';
import { goalProgressVerdict, type GoalProgressEntry } from './goal-progress.ts';
import { savingsProgress, type SavingsProgress } from './savings-goals.ts';
import { normalizeFinancePeriod, financePeriodContains, type FinanceDateRange, type FinancePeriod } from './finance-contract.ts';
import type { Point } from './wealth.ts';
import { t } from './i18n.ts';
/** All review facts come from one finance_sources read transaction. */
export type AnnualSources = FinanceSources;
type Block = { status: 'ready' | 'empty' | 'disabled' | 'error'; note: string };
/** 预设窗口的名称；自定义窗口按实际跨度描述，不假装覆盖了整段预设。 */
const presetLabels: Partial<Record<ReviewPeriodPreset, string>> = { '30d': '近 30 天变化', '6m': '近 6 个月变化', '1y': '近 1 年变化', ytd: '今年以来变化', all: '全部期间变化' };
export type AnnualSavingsGoal = {
  id: string; name: string; alias: string; created_on: string;
  basisDate: string | null; progress: SavingsProgress;
  note: string; shared: boolean; planningOverlap: boolean | null;
};
export type AnnualReviewModel = {
  period: FinancePeriod; range: FinanceDateRange; today: string; writeVersion: number; years: number[]; yearsNote: string | null;
  preset: ReviewPeriodPreset;
  /** 供标题与复制文本使用的窗口描述；「全部」不把内部起始日当成用户选择。 */
  windowLabel: string;
  net: Block & { from: Point | null; to: Point | null; completeCount: number; incompleteCount: number;
    delta_cents: string | null; label: string; points: Point[]; segments: Point[][]; scopeChanged: boolean; comparisonFailed: boolean };
  income: Block & { count: number; cents: string | null; hpf_known_cents: string | null; hpf_unknown_count: number };
  expenses: Block & { count: number; unknownCount: number; cents: string | null; refund_cents: string | null; sale_cents: string | null; undatedCount: number };
  savings: Block & { goals: AnnualSavingsGoal[] };
  planning: Block & { count: number; first: GoalProgressEntry | null; last: GoalProgressEntry | null; conditionsChanged: boolean; laterRecorded: boolean; openItems: boolean };
};
function unavailable(source: FinanceRead<unknown>, label: string): Block {
  return source.status === 'disabled' ? { status: 'disabled', note: t('{label}来源已关闭', { label }) } : { status: 'error', note: t('{label}读取失败，请重新读取', { label }) };
}
/** Unknown points and changes in scope break the visual line instead of being interpolated. */
export function annualTrendSegments(points: Point[]): Point[][] {
  const segments: Point[][] = []; let segment: Point[] = [];
  const flush = () => { if (segment.length) segments.push(segment); segment = []; };
  for (const p of points) {
    if (!p.complete) { flush(); continue; }
    const previous = segment.at(-1);
    if (previous && (p.scope_changed || p.change_cents === null || p.compared_to !== previous.date)) flush();
    segment.push(p);
  }
  flush(); return segments;
}
/** Calendar whole months, never an estimate based on days or annualized amounts. */
export function wholeReviewMonths(from: string, to: string): number {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  return Math.max(0, months - (Number(to.slice(8, 10)) < Number(from.slice(8, 10)) ? 1 : 0));
}
function sameRange(a: FinanceDateRange | undefined, b: FinanceDateRange): boolean {
  return !!a && a.from === b.from && a.to === b.to && a.includeFrom === b.includeFrom;
}
/** A mismatched or standard-purpose response cannot create a copyable model. */
export function buildAnnualReview(sources: AnnualSources, period: FinancePeriod, today: string, preset: ReviewPeriodPreset | boolean = 'custom'): AnnualReviewModel | null {
  if (period.kind !== 'year' && period.kind !== 'range') return null;
  // 旧的布尔参数只表示“近 12 个月”，保留给已有调用方。
  const windowPreset: ReviewPeriodPreset = preset === true ? '1y' : preset === false ? 'custom' : preset;
  const annual = sources.annual, range = normalizeFinancePeriod(period)!;
  if (!annual || !sameRange(annual.range, range) || !sameRange(normalizeFinancePeriod(sources.period) ?? undefined, range) || sources.period.kind !== period.kind || (period.kind === 'year' && annual.year !== period.year)) return null;
  const { from: start, to: end } = range;
  const windowLabel = windowPreset === 'all' ? `全部期间（截至 ${range.to}）` : `${range.from} 至 ${range.to}${range.includeFrom ? '' : '（不含起始日）'}`;
  const insideWindow = (date: string) => date <= today && financePeriodContains(period, date);
  const years = annual.years.status === 'ready' ? annual.years.value : sources.record_years.status === 'ready' ? sources.record_years.value : [];
  const model: AnnualReviewModel = {
    period, range, today, writeVersion: sources.write_version, preset: windowPreset, windowLabel,
    years: [...new Set([Number(today.slice(0, 4)), ...(period.kind === 'year' ? [period.year] : []), ...years])].sort((a, b) => b - a),
    yearsNote: annual.years.status === 'ready' ? null : '年份来源未完整读取；当前列表可能不全，可保留所选年份后重试。',
    net: { status: 'empty', note: t('该区间没有完整盘点'), from: null, to: null, completeCount: 0, incompleteCount: 0, delta_cents: null, label: t('记录间变化'), points: [], segments: [], scopeChanged: annual.scope_changed, comparisonFailed: false },
    income: { status: 'empty', note: t('该区间没有收入记录，不代表没有收入'), count: 0, cents: null, hpf_known_cents: null, hpf_unknown_count: 0 },
    expenses: { status: 'empty', note: t('该区间没有重要支出记录，不代表没有开销'), count: 0, unknownCount: 0, cents: null, refund_cents: null, sale_cents: null, undatedCount: 0 },
    savings: { status: 'empty', note: t('尚未建立存钱目标'), goals: [] },
    planning: { status: 'empty', note: t('该区间未记录可用的规划结论'), count: 0, first: null, last: null, conditionsChanged: false, laterRecorded: false, openItems: false },
  };
  if (sources.wealth.status !== 'ready') Object.assign(model.net, unavailable(sources.wealth, '账户与盘点'));
  else {
    const all = [...sources.wealth.value.points].filter(p => p.date <= end && p.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    const inside = all.filter(p => insideWindow(p.date)), complete = inside.filter(p => p.complete);
    const from = all.filter(p => p.complete && p.date <= start).at(-1) ?? complete[0] ?? null;
    const to = complete.at(-1) ?? null;
    const points = from && to ? all.filter(p => p.date >= from.date) : inside;
    const scopeChanged = annual.scope_changed || points.filter(p => p.complete).slice(1).some(p => p.scope_changed);
    Object.assign(model.net, { from: to ? from : null, to, completeCount: complete.length, incompleteCount: inside.length - complete.length, points, scopeChanged,
      segments: scopeChanged ? [] : annualTrendSegments(points) });
    if (to) {
      model.net.status = 'ready';
      const months = from ? wholeReviewMonths(from.date, to.date) : 0;
      model.net.label = !from || from.date === to.date ? '区间变化' : (windowPreset === 'all' || from.date <= range.from ? presetLabels[windowPreset] : undefined) ?? (months < 1 ? '区间变化' : months < 11 ? `自本区间首次盘点以来 ${months} 个月变化` : '区间变化');
      model.net.note = !from || from.date === to.date ? '只有一个有效端点，暂无可比较变化' : `实际盘点 ${from.date} 至 ${to.date}。`;
      if (from && from.date < to.date) {
        const c = annual.comparison;
        if (model.net.scopeChanged) model.net.note = '范围变化，暂不直接比较；期间的范围变化即使后来改回也不视为连续可比';
        else if (c.status !== 'ready') { model.net.note = unavailable(c, '盘点比较').note; model.net.comparisonFailed = c.status === 'error'; }
        else if (!c.value || c.value.from.snapshot_id !== from.snapshot_id || c.value.to.snapshot_id !== to.snapshot_id) model.net.note = '缺少匹配这两个端点的比较结果，请重新读取';
        else if (!c.value.reconciled || c.value.net_change_cents === null) model.net.note = '范围或条目状态不可比，暂不显示完整变化';
        else model.net.delta_cents = c.value.net_change_cents;
      }
    }
  }
  if (sources.incomes.status !== 'ready') Object.assign(model.income, unavailable(sources.incomes, '收入'));
  else {
    const rows = sources.incomes.value.filter(i => insideWindow(i.fields.date));
    if (rows.length) {
      const known = rows.filter(i => i.fields.hpf_cents !== null);
      Object.assign(model.income, { status: 'ready', count: rows.length, cents: incomeMetric({ status: 'ready', value: rows }).cents,
        hpf_known_cents: known.length ? known.reduce((n, i) => n + BigInt(i.fields.hpf_cents!), 0n).toString() : null,
        hpf_unknown_count: rows.length - known.length, note: t('仅已记录税后到账；记录数量不证明区间覆盖完整，公积金缴存单列') });
    }
  }
  if (sources.expenses.status !== 'ready') Object.assign(model.expenses, unavailable(sources.expenses, '重要支出'));
  else {
    const view = sources.expenses.value, spending = view.lines.filter(countsAsSpending);
    Object.assign(model.expenses, { status: view.lines.length ? 'ready' : 'empty', count: spending.length,
      unknownCount: spending.filter(l => l.amount_cents === null).length, cents: expenseMetric(sources.expenses).cents,
      refund_cents: view.lines.some(l => l.source === 'refund') ? view.refund_cents : null,
      sale_cents: view.lines.some(l => l.source === 'sale') ? view.sale_cents : null, undatedCount: view.undated.length,
      note: spending.length ? expenseMetric(sources.expenses).note + '；仅重要支出，不代表全部开销' : model.expenses.note });
  }
  if (annual.savings.status !== 'ready') Object.assign(model.savings, unavailable(annual.savings, '存钱目标'));
  else {
    const data = annual.savings.value;
    if (data.generation !== sources.generation || data.write_version !== sources.write_version || data.today !== today) Object.assign(model.savings, { status: 'error', note: t('目标来源与区间事实不一致，请重新读取') });
    else {
      const goals = data.goals.filter(v => !v.goal.deleted_at && v.goal.created_on <= today).map((v, index): AnnualSavingsGoal => ({
        id: v.goal.id, name: v.goal.fields.name, alias: `存钱目标 ${index + 1}`, created_on: v.goal.created_on,
        basisDate: data.basis?.date ?? null, progress: savingsProgress(v.goal.fields, v.observations, data.basis, today),
        note: data.newer_incomplete ? t('较新盘点不完整，沿用最近完整盘点的当前进度') : data.basis ? t('依据最近完整盘点的当前进度') : t('尚无完整盘点，当前进度未知'),
        shared: v.shared_account_ids.length > 0, planningOverlap: v.planning_overlap,
      }));
      Object.assign(model.savings, { goals, status: goals.length ? 'ready' : 'empty', note: t('当前目标进度，不随回顾区间回溯重算。不预留、不扣减资金，多个目标余额不能相加。') });
    }
  }
  if (annual.planning.status !== 'ready') Object.assign(model.planning, unavailable(annual.planning, '退休规划结论'));
  else {
    // The annual source contract supplies the whole selected window; never apply the legacy 24-row window here.
    const rows = annual.planning.value.filter(p => insideWindow(p.date)).sort((a, b) => a.date.localeCompare(b.date));
    const conditionsChanged = new Set(rows.map(r => JSON.stringify([r.point.mode, r.point.target_month]))).size > 1;
    Object.assign(model.planning, { status: rows.length ? 'ready' : 'empty', count: rows.length, first: rows[0] ?? null, last: rows.at(-1) ?? null,
      conditionsChanged, laterRecorded: rows.some(r => r.recorded_on > end), openItems: rows.some(r => r.point.has_open_items),
      note: rows.length ? t('某次盘点被目标页读取时留下的结论；并非每月自动留档。旧盘点更正后记录可能失效或替换，旧点未保存引擎版本。') : model.planning.note });
  }
  return model;
}

/** Controlled text only: neither mode includes names, notes, IDs or source error strings. */
export function annualCopyText(model: AnnualReviewModel, includeAmounts = false): string {
  const { net, income, expenses, savings, planning } = model;
  const lines = [`区间记录摘要（${includeAmounts ? '含金额版' : '隐私版'}）· ${model.windowLabel}`];
  if (net.status === 'ready' || net.status === 'empty') {
    lines.push(`完整盘点 ${net.completeCount} 次；另有 ${net.incompleteCount} 次记录不完整。`);
    if (net.to) {
      const range = net.from && net.from.date !== net.to.date ? `${net.from.date} 至 ${net.to.date}` : net.to.date;
      lines.push(`金融净资产：实际记录 ${range}；${net.delta_cents === null ? '暂无完整可比变化' : net.label}。`);
      if (includeAmounts) lines.push(`截至 ${net.to.date}：${money(net.to.net_cents)}${net.delta_cents === null ? '' : `；变化 ${money(net.delta_cents)}`}。`);
      else lines.push('金额与比例已隐藏。');
      lines.push(net.note);
    } else lines.push(net.note);
  } else lines.push(`金融净资产：${net.note}。`);
  lines.push(income.count ? `收入：已记录 ${income.count} 条；${includeAmounts && income.cents !== null ? `税后收入 ${money(income.cents)}；` : ''}不代表区间记录完整。` : `收入：${income.note}。`);
  if (includeAmounts && income.count) lines.push(`公积金缴存：${income.hpf_known_cents === null ? '没有已知金额' : `已知小计 ${money(income.hpf_known_cents)}`}；${income.hpf_unknown_count} 条金额未知。`);
  lines.push(`重要支出：${expenses.note}${includeAmounts && expenses.cents !== null ? `；退款前${expenses.unknownCount ? '已知小计' : '已记录金额'} ${money(expenses.cents)}` : ''}。`);
  if (includeAmounts && expenses.refund_cents !== null) lines.push(`退款：${money(expenses.refund_cents)}（单列）。`);
  if (includeAmounts && expenses.sale_cents !== null) lines.push(`售出回收：${money(expenses.sale_cents)}（单列）。`);
  if (expenses.undatedCount) lines.push(`另有 ${expenses.undatedCount} 条日期未知的支出记录，未计入本区间。`);
  lines.push(`存钱目标：${savings.note}`);
  for (const g of savings.goals) {
    lines.push(`${g.alias}：${g.note}${g.basisDate ? `；依据盘点 ${g.basisDate}` : ''}。`);
    if (includeAmounts) lines.push(`${g.alias} 当前进度：${g.progress.complete ? `${money(g.progress.known_cents)}；进度 ${((g.progress.percent_hundredths ?? 0) / 100).toFixed(2)}%` : '关联余额不完整，不显示完整进度'}。`);
  }
  lines.push(`退休规划：${planning.count ? `区间有效记录 ${planning.count} 条；` : ''}${planning.note}`);
  for (const r of planning.first ? [planning.first, ...(planning.last && planning.last.snapshot_id !== planning.first.snapshot_id ? [planning.last] : [])] : []) {
    lines.push(`规划记录：盘点 ${r.date}；实际记录于 ${r.recorded_on}${includeAmounts ? `；${goalProgressVerdict(r.point, money)}` : ''}。`);
    if (includeAmounts) lines.push(`原记录：${r.point.mode === 'fire' ? '财务自由' : '指定退休时间'}；目标月份 ${r.point.target_month ?? '未知'}；可用资金 ${money(r.point.available_cents)}；需要每月存 ${money(r.point.required_monthly_cents)}；当时每月投入 ${money(r.point.entered_monthly_cents)}。`);
  }
  if (planning.laterRecorded) lines.push('存在后来针对该盘点记录的结论，不等于该区间当时的实际判断。');
  if (planning.conditionsChanged || planning.openItems) lines.push('规划模式、目标月份或待确认条件可能不同，不计算退休时间的归因变化。');
  return lines.join('\n');
}
