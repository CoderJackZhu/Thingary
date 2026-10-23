// 首页「规划」摘要与目标页共用的纯投影：
// 结论文案、资产覆盖比例、历史常态储蓄与缺项判定都只在这里落字，两页不得各自取整或换口径。
// 计算本身复用 buildRetireCalc 与账本 required，本文件不另写估算。
import type { Income, PlanReview, ProfileState } from './plan.ts';
import type { Read } from './review.ts';
import type { Snapshot } from './wealth.ts';
import { forecastMoney } from './plan-format.ts';
import { progressHundredths, monthsLeftText } from './plan-fire.ts';
import { required, timeLabel } from './plan-ledger.ts';
import { buildRetireCalc } from './plan-retire-calc.ts';
import type { BasicCapabilities, PlanningSources } from './plan-basic-contract.ts';
import type { RetireCalc } from './plan-retire-calc.ts';
import { t } from './i18n.ts';
export type ReadyCalc = RetireCalc & { plan: NonNullable<RetireCalc['plan']>; proj: NonNullable<RetireCalc['proj']>; out: NonNullable<RetireCalc['out']>; assets: number };

export const yuan = forecastMoney;
/** 距今 offset 个月对应的估算年份（与目标页同一取整）。 */
export const yearOf = (today: string, offset: number) => Math.floor((Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset) / 12);

export type GoalHeadline = { main: string; sub: string | null; warn: string | null };

/** 退休结论：FIRE 显示还需多久／已覆盖／搜索终点内未达成；传统显示目标年龄与盈余或缺口。 */
export function goalHeadline(calc: ReadyCalc, today: string): GoalHeadline {
  const P = calc.plan, out = calc.out;
  const target = P.target_months;
  // 目标页已有的资金耗尽／必需支出缺口诊断：摘要只转述最重要的一条，不新造风险等级。
  const warn = out.failure_month !== null || out.shortfall_month !== null ? t('规划期内存在资金缺口，请查看目标') : null;
  if (P.input_mode === 'basic' && out.success && Math.abs(out.at_horizon) < 0.5) return { main: t('有限期间预算已覆盖'), sub: t('至 {v1}，终点无余量', { v1: timeLabel(P, P.horizon_months - 1) }), warn };
  if (P.mode === 'traditional') {
    const funded = out.funded_at_goal;
    const amount = funded ? Math.max(0, out.assets_at_goal - out.required_at_goal) : out.shortfall_at_goal;
    return { main: t('{v1} 开始使用规划资金', { v1: timeLabel(P, target) }), sub: P.input_mode === 'basic' && out.success && Math.abs(out.at_horizon) < 0.5 ? t('有限期间预算已覆盖，终点无余量') : `${funded ? t('预计盈余') : t('预计缺口')} ${yuan(amount)}`, warn };
  }
  const fi = calc.proj.fi_month;
  if (fi === null) {
    // 搜索终点取所选期限，不写成永远不可能。
    const capMonth = timeLabel(P, Math.min(P.search_cap_months, P.horizon_months - 1));
    return { main: t('当前假设下，{capMonth} 前尚未达成', { capMonth }), sub: null, warn };
  }
  if (fi <= P.now_months) return { main: t('当前资产已覆盖退休所需'), sub: t('估算'), warn };
  const toFi = fi - P.now_months;
  // 月龄不截成整岁，避免与目标页给出相反的按期判断（§5.3）。
  const sub = t('约 {v1} 年 · {v2}{v3}', { v1: yearOf(today, toFi), v2: timeLabel(P, fi), v3: fi > target ? `，晚于期望的 ${timeLabel(P, target)}` : '' });
  return { main: t('预计还需 {v1}', { v1: monthsLeftText(toFi) }), sub, warn };
}

/** 资产覆盖比例：当前可支配资产 ÷ 今天退休所需，与目标页同一函数与精度。 */
export function coverageNow(calc: ReadyCalc): { assets: number; requiredNow: number; percent: number } {
  const requiredNow = required(calc.plan, calc.plan.now_months);
  return { assets: calc.assets, requiredNow, percent: progressHundredths(calc.assets, requiredNow) };
}

export type UsualSaving =
  | { kind: 'known'; monthly_cents: string; count: number; low_sample: boolean; window_from: string | null; latest_date: string | null; negative: boolean }
  | { kind: 'unknown'; reason: string };

/** 历史月均净资产变化（含估值变化）：只看 plan_review 的统计，不被预计投入覆盖。 */
export function usualSaving(review: PlanReview): UsualSaving {
  const s = review.stats;
  if (s.mean_monthly_change_cents != null) {
    return { kind: 'known', monthly_cents: s.mean_monthly_change_cents, count: s.change_count ?? s.count, low_sample: (s.change_count ?? s.count) < 3, window_from: s.window_from, latest_date: s.latest_date, negative: s.mean_monthly_change_cents.startsWith('-') };
  }
  let reason: string;
  const current = review.intervals.filter(i => i.in_window);
  const usable = current.filter(i => i.status === 'ok' && !i.excluded);
  if (s.latest_date === null) reason = t('还没有完整盘点。');
  else if (!review.intervals.length) reason = t('需要至少两次完整盘点。');
  else if (!current.length) reason = t('近 12 个月没有可比较的两次盘点。');
  else if (!usable.length) {
    if (current.some(i => !i.excluded && i.status === 'no_income')) reason = t('这段时间还没有记录月度收入。');
    else if (current.some(i => !i.excluded && i.status === 'scope_changed')) reason = t('参与比较的账户有变化，暂时没有可直接比较的盘点区间。');
    else reason = t('可比较的盘点区间都已标记为一次性变动。');
  } else reason = t('可比较的盘点区间还不够。');
  return { kind: 'unknown', reason };
}

/** 摘要读取层给出的各来源（独立成败，见 review_overview）。 */
export type PlanSources = { review: Read<PlanReview>; incomes: Read<Income[]>; profile: Read<ProfileState>; snapshot: Read<Snapshot | null>; snapshotId: string | null; snapshotDate: string | null; generation?: string; writeVersion?: number; modules?: PlanningSources['modules'] };

export type SummaryRetire =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'blocked'; step: 'snapshot' | 'profile' | 'budget' | 'saving' | 'other'; main: string; note: string; capabilities?: BasicCapabilities }
  | { kind: 'ready'; mode: 'fire' | 'traditional'; headline: GoalHeadline; coverage: { assets: number; requiredNow: number; percent: number }; snapshotDate: string | null; hasEvents: boolean; calc: ReadyCalc };

/** 缺项优先顺序（§6.1）：读取失败 → 无完整盘点 → 无个人资料 → 无退休预算 → 缺储蓄依据 → 其他。 */
export function summaryRetire(sources: PlanSources, today: string): SummaryRetire {
  if (sources.profile.status === 'ready' && sources.profile.value.saved?.profile.retire.basic) {
    const saved = sources.profile.value.saved;
    const native: PlanningSources = { generation: sources.generation ?? sources.profile.value.generation, write_version: sources.writeVersion ?? saved.revision, today, modules: sources.modules ?? { planning: true, wealth: sources.snapshot.status === 'ready' && sources.snapshot.value !== null }, profile: sources.profile, snapshot: sources.snapshot, accounts: { status: 'ready', value: [] }, review: sources.review, incomes: sources.incomes };
    const calc = buildRetireCalc(saved, null, null, [], today, native), capabilities = calc.capabilities!;
    if (capabilities.requirement.status === 'blocked') return { kind: 'blocked', step: 'other', main: t('补充以下资料后可计算'), note: capabilities.requirement.missing[0]?.message ?? t('还需确认计算来源'), capabilities };
    if (!calc.plan || !calc.proj || !calc.out || calc.assets === null) {
      const n = capabilities.requirement.value.set;
      const main = n.status === 'found' ? t('目标所需月投入 {v1}', { v1: yuan(Number(n.monthly_cents)) }) : n.status === 'no_positive_contribution' ? t('无需新增正投入') : t('还需确认目标条件');
      return { kind: 'blocked', step: 'saving', main, note: t('需求按固定目标计算；保存明确预计投入后可查看预测。'), capabilities };
    }
    const ready = calc as ReadyCalc;
    return { kind: 'ready', mode: ready.plan.mode, headline: goalHeadline(ready, today), coverage: coverageNow(ready), snapshotDate: capabilities.context.start.date, hasEvents: ready.events.some(e => e.included), calc: ready };
  }
  if (sources.profile.status === 'error') return { kind: 'error', message: sources.profile.value.message };
  return { kind: 'blocked', step: 'profile', main: sources.profile.value.saved ? t('退休目标待重新设置') : t('先设置退休目标'), note: t('请确认目标与完整预算；盘点、收入、实际缴存、付款与欠款资料都会保留。') };
}

/** 依据说明：盘点日期、未来储蓄采用的口径、已计入的大额计划与「按当前假设估算」。 */
export function basisNotes(calc: ReadyCalc, snapshotDate: string | null): string[] {
  return [
    snapshotDate ? t('依据 {snapshotDate} {v2}', { snapshotDate, v2: calc.r.basic?.start.kind === 'simulation' ? '手填金额' : '完整盘点' }) : null,
    t('预测采用已保存的单一预计投入'),
    calc.events.some(e => e.included || calc.r.core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred')) ? t('已计入大额计划') : null,
    t('估算'),
  ].filter((x): x is string => x !== null);
}

export function summaryBasis(retire: Extract<SummaryRetire, { kind: 'ready' }>): string[] {
  return basisNotes(retire.calc, retire.snapshotDate).filter(note => note !== '估算');
}
