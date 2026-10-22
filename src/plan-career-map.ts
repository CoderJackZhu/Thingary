// Window map: when the high-income window closes, how long a gap can be survived, and how long the window must last.
// A thin read-only layer over evaluateCareerScenario. It predicts nothing: every number is "under these conditions".
import { prepareBasicPlan } from './plan-basic.ts';
import type { PlanningSources } from './plan-basic-contract.ts';
import { monthIndex } from './plan-events.ts';
import { evaluateCareerScenario } from './plan-career.ts';
import { careerMonth, validCareerMonth, validCareerAmount } from './plan-career-contract.ts';
import type { CareerDraft, CareerEvaluation } from './plan-career-contract.ts';
import { t } from './i18n.ts';
export type Verdict = 'meets' | 'short' | 'blocked';
/** goal: ends below the required assets; cash: a known payment fails inside the gap; prefix: a failure no later income can fix. */
export type Reason = 'goal' | 'cash' | 'prefix';
export type Judgement = { verdict: Verdict; reason: Reason | null; shortfall_cents: number | null; issues: string[] };

/** One verdict per evaluation. Unknown inputs stay "blocked"; they are never read as zero. */
export function judge(ev: CareerEvaluation): Judgement {
  const cash = ev.cash.status === 'ready' ? ev.cash.value : null;
  // A gap whose payment check could not run is not a pass. "No gap interval" is the only blocked reason that is fine.
  if (ev.cash.status === 'blocked') {
    if (ev.cash.issues.some(i => i.field === 'funds')) return { verdict: 'short', reason: 'cash', shortfall_cents: null, issues: [] };
    if (ev.cash.issues.some(i => i.field !== 'gap_months')) return { verdict: 'blocked', reason: null, shortfall_cents: null, issues: ev.cash.issues.map(i => i.message) };
  }
  if (cash?.first_shortfall_month || cash?.floor_month) return { verdict: 'short', reason: 'cash', shortfall_cents: null, issues: [] };
  if (ev.requirement.status === 'ready' && 'status' in ev.requirement.value && ['prefix_payment_gap', 'prefix_floor_breach'].includes(ev.requirement.value.status)) return { verdict: 'short', reason: 'prefix', shortfall_cents: null, issues: [] };
  if (ev.prediction.status === 'ready') {
    const o = ev.prediction.value.outcome;
    return o.success && o.funded_at_goal ? { verdict: 'meets', reason: null, shortfall_cents: 0, issues: [] } : { verdict: 'short', reason: 'goal', shortfall_cents: Math.max(0, Math.round(o.shortfall_at_goal)), issues: [] };
  }
  return { verdict: 'blocked', reason: null, shortfall_cents: null, issues: ev.prediction.issues.map(i => i.message) };
}

/** Absolute month indices of the funds start and the target month, or null when the common inputs are missing. */
export function careerSpan(sources: PlanningSources): { now: number; target: number } | null {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null, date = prepareBasicPlan(sources, '0').context.start.date;
  if (!p?.retire.simplified.time.target_month || !p.retire.basic || !date) return null;
  return { now: monthIndex(date.slice(0, 7)), target: monthIndex(p.retire.simplified.time.target_month) };
}

/** Evaluate with a handful of overridden fields; neither sources nor draft are mutated. */
function run(sources: PlanningSources, draft: CareerDraft, over: { close?: number; gap?: number; recovery?: string | null }): CareerEvaluation {
  const d = structuredClone(draft);
  if (over.close !== undefined) d.transition_month = careerMonth(over.close);
  if (over.gap !== undefined) d.gap_months = over.gap;
  if (over.recovery !== undefined) d.recovery.monthly_cents = over.recovery;
  return evaluateCareerScenario(sources, d, { requirement: 'skip' });
}

export type MapCell = Judgement & { close_month: string; recovery_cents: string };
export type WindowMap = { closes: string[]; recoveries: string[]; rows: MapCell[][] };
/** Close month x post-window contribution. Gap length stays as in the draft (0 = a direct change). */
export function windowMap(sources: PlanningSources, draft: CareerDraft, closes: string[], recoveries: string[]): WindowMap {
  const rows = recoveries.map(l => closes.map(c => ({ close_month: c, recovery_cents: l, ...judge(run(sources, draft, { close: monthIndex(c), recovery: l })) })));
  return { closes, recoveries, rows };
}

/** Evenly spaced close months from the funds start to just before the target. */
export function closeMonths(sources: PlanningSources, stepMonths = 12): string[] {
  const span = careerSpan(sources);
  if (!span) return [];
  const out: string[] = [];
  for (let m = span.now; m < span.target; m += stepMonths) out.push(careerMonth(m));
  return out;
}

export type MinWindow =
  | { status: 'found'; months: number; close_month: string }
  | { status: 'already_met' }
  | { status: 'not_reachable'; message: string }
  | { status: 'not_applicable' | 'blocked'; message: string };
const bad = (status: 'not_applicable' | 'blocked', message: string): MinWindow => ({ status, message });

/** Exhaustive bounded monthly search. Stage costs and payment timing can break monotonicity.
 * Only the earliest feasible candidate is reported; later months are not implied to be feasible. */
export function minWindow(sources: PlanningSources, draft: CareerDraft): MinWindow {
  const span = careerSpan(sources);
  if (!span) return bad('blocked', '请先确认通用资料、目标月份和资金截至日。');
  if (!validCareerAmount(draft.recovery.monthly_cents, true)) return bad('blocked', '请先填关闭后每月能攒多少。');
  if (draft.gap_months === null || !Number.isInteger(draft.gap_months) || draft.gap_months < 0 || draft.gap_months > 1200) return bad('blocked', '请确认合法的空窗月数。');
  const hi = span.target - 1 - draft.gap_months;
  if (hi < span.now) return bad('blocked', '空窗加恢复超出原目标，没有可比较的关闭月。');
  if (hi - span.now > 1200) return bad('blocked', '本次逐月搜索最多覆盖 1200 个月，请缩短目标范围。');
  for (let m = span.now; m <= hi; m++) {
    const j = judge(run(sources, draft, { close: m }));
    if (j.verdict === 'blocked') return bad('blocked', j.issues.join(' ') || '部分候选条件不完整，不能确定最早月份。');
    if (j.verdict === 'meets') return m === span.now ? { status: 'already_met' } : { status: 'found', months: m - span.now, close_month: careerMonth(m) };
  }
  return { status: 'not_reachable', message: t('已检查 {v1} 至 {v2}，没有满足的变化月；未据此判断维持当前工作到目标月的结果。', { v1: careerMonth(span.now), v2: careerMonth(hi) }) };
}

export type MaxGap =
  | { status: 'found'; months: number; limit: Reason | 'end'; ranges?: { from: number; to: number }[] }
  | { status: 'none'; reason: Reason | null }
  | { status: 'not_applicable' | 'blocked'; message: string };

/** Scan every gap length, including discontinuous feasible ranges; blocked is not a failed candidate. */
export function maxGap(sources: PlanningSources, draft: CareerDraft): MaxGap {
  const span = careerSpan(sources);
  if (!span) return { status: 'blocked', message: t('请先确认通用资料、目标月份和资金截至日。') };
  if (!validCareerMonth(draft.transition_month) || !validCareerAmount(draft.recovery.monthly_cents, true)) return { status: 'blocked', message: t('请先填合法的变化月份和恢复后每月能攒多少。') };
  const close = monthIndex(draft.transition_month), cap = span.target - close - 1;
  if (close < span.now || cap < 0 || cap > 1200) return { status: 'blocked', message: t('变化月须在起点至目标之前，搜索范围不超过 1200 个月。') };
  const ranges: { from: number; to: number }[] = [];
  let following: Reason | null = null, firstReason: Reason | null = null;
  for (let g = 0; g <= cap; g++) {
    const j = judge(run(sources, draft, { gap: g }));
    if (j.verdict === 'blocked') return { status: 'blocked', message: j.issues.join(' ') || t('部分候选条件不完整，不能确定最长空窗。') };
    if (g === 0) firstReason = j.reason;
    const last = ranges.at(-1);
    if (j.verdict === 'meets') {
      if (last && last.to === g - 1) last.to = g;
      else ranges.push({ from: g, to: g });
    } else if (last && last.to === g - 1) following = j.reason;
  }
  const last = ranges.at(-1);
  if (!last) return { status: 'none', reason: firstReason };
  return { status: 'found', months: last.to, limit: last.to === cap ? 'end' : following ?? 'goal', ...(ranges.length > 1 || ranges[0].from > 0 ? { ranges } : {}) };
}

export type DelayTarget =
  | { status: 'found'; month: string; delay_months: number }
  | { status: 'already_met' }
  | { status: 'not_found'; up_to_month: string }
  | { status: 'blocked'; message: string };
/** Explicit monthly target comparison. No stored age or policy inputs are reconstructed. */
export function delayTarget(sources: PlanningSources, draft: CareerDraft, maxMonths = 1200): DelayTarget {
  const r = profileOf(sources)?.retire, time = r?.simplified.time;
  if (!r?.basic || !time?.target_month || !time.horizon_month || !Number.isInteger(maxMonths) || maxMonths < 0 || maxMonths > 1200) return { status: 'blocked', message: t('请确认通用资料、目标与终点月份。') };
  const original = monthIndex(time.target_month), last = Math.min(monthIndex(time.horizon_month) - 1, original + maxMonths);
  const at = (m: number) => {
    const copy = structuredClone(sources);
    if (copy.profile.status === 'ready' && copy.profile.value.saved) copy.profile.value.saved.profile.retire.simplified.time.target_month = careerMonth(m);
    return judge(evaluateCareerScenario(copy, draft, { requirement: 'skip' }));
  };
  for (let m = original; m <= last; m++) {
    const j = at(m);
    if (j.verdict === 'blocked') return { status: 'blocked', message: j.issues.join(' ') || t('条件未齐全。') };
    if (j.verdict === 'meets') return m === original ? { status: 'already_met' } : { status: 'found', month: careerMonth(m), delay_months: m - original };
  }
  return { status: 'not_found', up_to_month: careerMonth(last) };
}
/** Display only: an age exists solely after a new user confirmation. */
export function ageMonthsAt(sources: PlanningSources, month: string): number | null {
  const ref = profileOf(sources)?.retire.simplified.time.reference;
  return ref && validCareerMonth(month) ? ref.age_months + monthIndex(month) - monthIndex(ref.month) : null;
}
function profileOf(sources: PlanningSources) { return sources.profile.status === 'ready' ? sources.profile.value.saved?.profile ?? null : null; }
export type Missing = { label: string; assumable: false };
/** Unknown cash expenses stay unknown. A missing answer never implies zero. */
export function missingItems(draft: CareerDraft, needRecovery: boolean): Missing[] {
  const out: Missing[] = [];
  if (needRecovery && !validCareerAmount(draft.recovery.monthly_cents, true)) out.push({ label: t('找到新工作后每月能攒多少'), assumable: false });
  if (draft.gap_months !== 0 && draft.gap.insurance.monthly_cents === null) out.push({ label: t('空窗期间的现金费用及包含范围'), assumable: false });
  if (needRecovery && draft.recovery.insurance.monthly_cents === null) out.push({ label: t('恢复后的现金费用及包含范围'), assumable: false });
  return out;
}
