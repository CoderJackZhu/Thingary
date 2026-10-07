// 首页「规划」摘要与目标页共用的纯投影（OVERVIEW_PLANNING_DESIGN §4、§6.1）：
// 结论文案、资产覆盖比例、历史常态储蓄与缺项判定都只在这里落字，两页不得各自取整或换口径。
// 计算本身复用 buildRetireCalc 与账本 required，本文件不另写估算。
import { ageText } from './plan.ts';
import type { Income, PlanReview, ProfileState } from './plan.ts';
import type { Read } from './review.ts';
import type { Snapshot } from './wealth.ts';
import { money } from './asset.ts';
import { progressHundredths, monthsLeftText } from './plan-fire.ts';
import { required } from './plan-ledger.ts';
import { buildRetireCalc } from './plan-retire-calc.ts';
import type { BasicCapabilities, PlanningSources } from './plan-basic-contract.ts';
import type { RetireCalc } from './plan-retire-calc.ts';

export type ReadyCalc = RetireCalc & { plan: NonNullable<RetireCalc['plan']>; proj: NonNullable<RetireCalc['proj']>; out: NonNullable<RetireCalc['out']>; assets: number };

export const yuan = (cents: number) => money(String(Math.round(cents)));
/** 距今 offset 个月对应的估算年份（与目标页同一取整）。 */
export const yearOf = (today: string, offset: number) => Math.floor((Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset) / 12);

export type GoalHeadline = { main: string; sub: string | null; warn: string | null };

/** 退休结论：FIRE 显示还需多久／已覆盖／搜索终点内未达成；传统显示目标年龄与盈余或缺口。 */
export function goalHeadline(calc: ReadyCalc, today: string): GoalHeadline {
  const P = calc.plan, out = calc.out;
  const target = P.target_months;
  // 目标页已有的资金耗尽／必需支出缺口诊断：摘要只转述最重要的一条，不新造风险等级。
  const warn = out.failure_month !== null || out.shortfall_month !== null ? '规划期内存在资金缺口，请查看目标' : null;
  if (P.input_mode === 'basic' && out.success && Math.abs(out.at_horizon) < 0.5) return { main: '有限期间预算已覆盖', sub: `至 ${Math.floor(P.horizon_months / 12)} 岁，终点无余量`, warn };
  if (P.mode === 'traditional') {
    const funded = out.funded_at_goal;
    const amount = funded ? Math.max(0, out.assets_at_goal - out.required_at_goal) : out.shortfall_at_goal;
    return { main: `${Math.floor(target / 12)} 岁退休`, sub: P.input_mode === 'basic' && out.success && Math.abs(out.at_horizon) < 0.5 ? '有限期间预算已覆盖，终点无余量' : `${funded ? '预计盈余' : '预计缺口'} ${yuan(amount)}`, warn };
  }
  const fi = calc.proj.fi_month;
  if (fi === null) {
    // 搜索终点取实际值（终点年龄早于 70 岁时按实际），不写成永远不可能。
    const capAge = Math.floor(Math.min(P.search_cap_months, P.horizon_months) / 12);
    return { main: `当前假设下，${capAge} 岁前尚未达成`, sub: null, warn };
  }
  if (fi <= P.now_months) return { main: '当前资产已覆盖退休所需', sub: '按当前假设估算', warn };
  const toFi = fi - P.now_months;
  // 月龄不截成整岁，避免与目标页给出相反的按期判断（§5.3）。
  const sub = `约 ${yearOf(today, toFi)} 年 · ${ageText(fi)}${fi > target ? `，晚于期望的 ${Math.floor(target / 12)} 岁` : ''}`;
  return { main: `预计还需 ${monthsLeftText(toFi)}`, sub, warn };
}

/** 资产覆盖比例：当前可支配资产 ÷ 今天退休所需，与目标页同一函数与精度。 */
export function coverageNow(calc: ReadyCalc): { assets: number; requiredNow: number; percent: number } {
  const requiredNow = required(calc.plan, calc.plan.now_months);
  return { assets: calc.assets, requiredNow, percent: progressHundredths(calc.assets, requiredNow) };
}

export type UsualSaving =
  | { kind: 'known'; monthly_cents: string; count: number; low_sample: boolean; window_from: string | null; latest_date: string | null; negative: boolean }
  | { kind: 'unknown'; reason: string };

/** 历史月均净资产变化（含估值变化）：只看 plan_review 的统计，不被储蓄阶段覆盖。 */
export function usualSaving(review: PlanReview): UsualSaving {
  const s = review.stats;
  if (s.mean_monthly_change_cents != null) {
    return { kind: 'known', monthly_cents: s.mean_monthly_change_cents, count: s.change_count ?? s.count, low_sample: (s.change_count ?? s.count) < 3, window_from: s.window_from, latest_date: s.latest_date, negative: s.mean_monthly_change_cents.startsWith('-') };
  }
  let reason: string;
  const current = review.intervals.filter(i => i.in_window);
  const usable = current.filter(i => i.status === 'ok' && !i.excluded);
  if (s.latest_date === null) reason = '还没有完整盘点。';
  else if (!review.intervals.length) reason = '需要至少两次完整盘点。';
  else if (!current.length) reason = '近 12 个月内没有可比区间。';
  else if (!usable.length) {
    if (current.some(i => !i.excluded && i.status === 'no_income')) reason = '这段时间还没有记录月度收入。';
    else if (current.some(i => !i.excluded && i.status === 'scope_changed')) reason = '账户计入范围变化，暂无可比区间。';
    else reason = '可比区间都已标记为一次性变动。';
  } else reason = '可比区间不足。';
  return { kind: 'unknown', reason };
}

/** 摘要读取层给出的各来源（独立成败，见 review_overview）。 */
export type PlanSources = { review: Read<PlanReview>; incomes: Read<Income[]>; profile: Read<ProfileState>; snapshot: Read<Snapshot | null>; snapshotId: string | null; snapshotDate: string | null; generation?: string; writeVersion?: number; modules?: PlanningSources['modules'] };

export type SummaryRetire =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'blocked'; step: 'snapshot' | 'profile' | 'budget' | 'saving' | 'other'; main: string; note: string; capabilities?: BasicCapabilities }
  | { kind: 'ready'; mode: 'fire' | 'traditional'; headline: GoalHeadline; coverage: { assets: number; requiredNow: number; percent: number }; snapshotDate: string | null; usesPhases: boolean; hasEvents: boolean; calc: ReadyCalc };

/** 缺项优先顺序（§6.1）：读取失败 → 无完整盘点 → 无个人资料 → 无退休预算 → 缺储蓄依据 → 其他。 */
export function summaryRetire(sources: PlanSources, today: string): SummaryRetire {
  if (sources.profile.status === 'ready' && sources.profile.value.saved?.profile.retire.basic) {
    const saved = sources.profile.value.saved;
    const native: PlanningSources = { generation: sources.generation ?? sources.profile.value.generation, write_version: sources.writeVersion ?? saved.revision, today, modules: sources.modules ?? { planning: true, wealth: sources.snapshot.status === 'ready' && sources.snapshot.value !== null }, profile: sources.profile, snapshot: sources.snapshot, accounts: { status: 'ready', value: [] }, review: sources.review, incomes: sources.incomes };
    const calc = buildRetireCalc(saved, null, null, [], today, native), capabilities = calc.capabilities!;
    if (capabilities.requirement.status === 'blocked') return { kind: 'blocked', step: 'other', main: '需求输入待核对', note: capabilities.requirement.missing[0]?.message ?? '来源待核对', capabilities };
    if (!calc.plan || !calc.proj || !calc.out || calc.assets === null) {
      const n = capabilities.requirement.value.set;
      const main = n.status === 'found' ? `目标所需月投入 ${yuan(Number(n.monthly_cents))}` : n.status === 'no_positive_contribution' ? '无需新增正投入' : '目标需求待核对';
      return { kind: 'blocked', step: 'saving', main, note: '需求按固定目标计算；保存明确预计投入后可查看预测。', capabilities };
    }
    const ready = calc as ReadyCalc;
    return { kind: 'ready', mode: ready.plan.mode, headline: goalHeadline(ready, today), coverage: coverageNow(ready), snapshotDate: capabilities.context.start.date, usesPhases: false, hasEvents: ready.events.some(e => e.included), calc: ready };
  }
  // 逐个检查以便类型收窄；个人资料失败优先展示（§6.1：统计已成功时保留历史储蓄）。
  if (sources.profile.status === 'error') return { kind: 'error', message: sources.profile.value.message };
  if (sources.review.status === 'error') return { kind: 'error', message: sources.review.value.message };
  if (sources.incomes.status === 'error') return { kind: 'error', message: sources.incomes.value.message };
  if (sources.snapshot.status === 'error') return { kind: 'error', message: sources.snapshot.value.message };
  if (!sources.snapshotId || !sources.snapshot.value) return { kind: 'blocked', step: 'snapshot', main: '先完成一次完整盘点', note: '退休估算需要最近一次完整盘点里的资产明细。' };
  const saved = sources.profile.value.saved;
  if (!saved) return { kind: 'blocked', step: 'profile', main: '先填写个人资料', note: '退休与财务自由的估算需要出生年月和缴费资料。' };
  const calc = buildRetireCalc(saved, sources.snapshot.value, sources.review.value, sources.incomes.value, today);
  if (calc.spend === null) return { kind: 'blocked', step: 'budget', main: '先确定退休后的月预算', note: '补齐后才能估算退休时间。' };
  if (calc.saving === null) return { kind: 'blocked', step: 'saving', main: '未来净投入待确认', note: '请在目标的储蓄阶段中保存明确假设，历史资产变化不会自动采用。' };
  if (!calc.plan || !calc.proj || !calc.out) return { kind: 'blocked', step: 'other', main: '计算输入不足', note: calc.missing[0] ?? '请到目标页核对假设。' };
  const ready = calc as ReadyCalc;
  return {
    kind: 'ready', mode: ready.plan.mode, headline: goalHeadline(ready, today), coverage: coverageNow(ready),
    snapshotDate: sources.snapshotDate, usesPhases: ready.r.saving_phases.length > 0 || ready.r.route_id !== null, hasEvents: ready.events.some(e => e.included || ready.r.core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred')), calc: ready,
  };
}

/** 依据说明：盘点日期、未来储蓄采用的口径、已计入的大额计划与「按当前假设估算」。 */
export function basisNotes(calc: ReadyCalc, snapshotDate: string | null): string[] {
  return [
    snapshotDate ? `依据 ${snapshotDate} ${calc.r.basic?.start.kind === 'simulation' ? '模拟起点' : '完整盘点'}` : null,
    calc.r.basic ? '预测采用已保存的单一预计投入' : calc.r.saving_phases.length || calc.r.route_id ? '退休估算采用已设置的储蓄阶段／路线' : '未来净投入待确认',
    calc.events.some(e => e.included || calc.r.core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred')) ? '已计入大额计划' : null,
    '按当前假设估算',
  ].filter((x): x is string => x !== null);
}

export function summaryBasis(retire: Extract<SummaryRetire, { kind: 'ready' }>): string[] {
  return basisNotes(retire.calc, retire.snapshotDate);
}
