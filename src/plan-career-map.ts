// Window map: when the high-income window closes, how long a gap can be survived, and how long the window must last.
// A thin read-only layer over evaluateCareerScenario. It predicts nothing: every number is "under these conditions".
import { prepareBasicPlan } from './plan-basic.ts';
import type { PlanningSources } from './plan-basic-contract.ts';
import { monthIndex } from './plan-events.ts';
import { evaluateCareerScenario } from './plan-career.ts';
import { careerMonth, validCareerMonth, validCareerAmount } from './plan-career-contract.ts';
import type { CareerDraft, CareerEvaluation, CareerPension } from './plan-career-contract.ts';

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
  if (!p?.birth_month || !p.retire.basic || !date) return null;
  return { now: monthIndex(date.slice(0, 7)), target: monthIndex(p.birth_month) + (p.retire.target_age ?? p.retire.horizon_age) * 12 };
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

/** Exhaustive bounded monthly search. Stage costs and pension eligibility can break monotonicity.
 * Only the earliest feasible candidate is reported; later months are not implied to be feasible. */
export function minWindow(sources: PlanningSources, draft: CareerDraft): MinWindow {
  const span = careerSpan(sources);
  if (!span) return bad('blocked', '请先确认通用资料、出生年月和资金截至日。');
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
  return { status: 'not_reachable', message: `已检查 ${careerMonth(span.now)} 至 ${careerMonth(hi)}，没有满足的变化月；未据此判断维持当前工作到目标月的结果。` };
}

export type MaxGap =
  | { status: 'found'; months: number; limit: Reason | 'end'; ranges?: { from: number; to: number }[] }
  | { status: 'none'; reason: Reason | null }
  | { status: 'not_applicable' | 'blocked'; message: string };

/** Scan every gap length, including discontinuous feasible ranges; blocked is not a failed candidate. */
export function maxGap(sources: PlanningSources, draft: CareerDraft): MaxGap {
  const span = careerSpan(sources);
  if (!span) return { status: 'blocked', message: '请先确认通用资料、出生年月和资金截至日。' };
  if (!validCareerMonth(draft.transition_month) || !validCareerAmount(draft.recovery.monthly_cents, true)) return { status: 'blocked', message: '请先填合法的变化月份和恢复后每月能攒多少。' };
  const close = monthIndex(draft.transition_month), cap = span.target - close - 1;
  if (close < span.now || cap < 0 || cap > 1200) return { status: 'blocked', message: '变化月须在起点至目标之前，搜索范围不超过 1200 个月。' };
  const ranges: { from: number; to: number }[] = [];
  let following: Reason | null = null, firstReason: Reason | null = null;
  for (let g = 0; g <= cap; g++) {
    const j = judge(run(sources, draft, { gap: g }));
    if (j.verdict === 'blocked') return { status: 'blocked', message: j.issues.join(' ') || '部分候选条件不完整，不能确定最长空窗。' };
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

export type PensionChoice = { label: string; pension: CareerPension; /** Monthly cash the user pays for this choice (bill amount). null = not entered yet; it is never read as zero. */ cash_cents: string | null; included?: boolean; /** When set, the row is not evaluated and shows this reason (e.g. a custom base not entered yet). */ blocked?: string };
export type PensionRow = {
  label: string; cash_cents: string | null; judgement: Judgement;
  /** Cash paid over the whole stage under this choice; null when the stage length is unknown. */
  stage_cash_cents: number | null;
  /** Estimated benefit at the target month, only when the Beijing pension is selected for retirement income. */
  pension: { eligible: boolean; short_months: number; monthly_cents: number; lump_cents: number } | null;
  assets_at_goal_cents: number | null;
};
/** The draft with one stage's contribution arrangement and its monthly cash cost replaced; nothing is mutated. */
export function withChoice(draft: CareerDraft, stage: 'gap' | 'recovery', choice: PensionChoice): CareerDraft {
  const d = structuredClone(draft);
  d[stage].pension = choice.blocked ? null : structuredClone(choice.pension);
  d[stage].insurance = { monthly_cents: choice.cash_cents, included: choice.included ?? false };
  return d;
}

/** Same scenario, one stage's contribution arrangement swapped. Differences are the point: read rows against each other. */
export function pensionOptions(sources: PlanningSources, draft: CareerDraft, stage: 'gap' | 'recovery', choices: PensionChoice[]): { stage_months: number | null; rows: PensionRow[] } {
  const span = careerSpan(sources), basic = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile.retire.basic : null;
  const start = draft.transition_month ? monthIndex(draft.transition_month) : null, gap = draft.gap_months;
  const months = !span || start === null ? null : stage === 'gap' ? gap : gap === null ? null : Math.max(0, span.target - (start + gap));
  const rows = choices.map((c): PensionRow => {
    if (c.blocked) return { label: c.label, cash_cents: c.cash_cents, judgement: { verdict: 'blocked', reason: null, shortfall_cents: null, issues: [c.blocked] }, stage_cash_cents: null, pension: null, assets_at_goal_cents: null };
    if (!validCareerAmount(c.cash_cents)) return { label: c.label, cash_cents: c.cash_cents, judgement: { verdict: 'blocked', reason: null, shortfall_cents: null, issues: ['请填每月现金社保；没有也要明确填 0。'] }, stage_cash_cents: null, pension: null, assets_at_goal_cents: null };
    const ev = evaluateCareerScenario(sources, withChoice(draft, stage, c)), ready = ev.prediction.status === 'ready' ? ev.prediction.value : null;
    const p = ready && basic?.retirement_income.mode === 'beijing' ? ready.plan.pension_at(ready.plan.target_months) : null;
    return {
      label: c.label, cash_cents: c.cash_cents, judgement: judge(ev),
      stage_cash_cents: months === null ? null : months * Number(c.cash_cents),
      pension: p ? { eligible: p.eligible !== false, short_months: p.short_months ?? 0, monthly_cents: Math.round(p.monthly_cents), lump_cents: Math.round(p.lump_cents) } : null,
      assets_at_goal_cents: ready ? Math.round(ready.outcome.assets_at_goal) : null,
    };
  });
  return { stage_months: months, rows };
}

export type DelayTarget =
  | { status: 'found'; age: number; delay_years: number }
  | { status: 'already_met' }
  | { status: 'not_found'; up_to_age: number }
  | { status: 'blocked'; message: string };

/** Earliest whole retirement age at which the draft's conditions meet the goal, scanning later and later targets.
 *  A concession shown beside the original target, never written back. Contributions keep following the confirmed schedule. */
export function delayTarget(sources: PlanningSources, draft: CareerDraft, maxAge = 75): DelayTarget {
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null, r = saved?.profile.retire;
  if (!r?.basic) return { status: 'blocked', message: '请先确认通用资料。' };
  const original = r.target_age ?? r.horizon_age, last = Math.min(r.horizon_age - 1, maxAge);
  const at = (age: number) => {
    const copy = structuredClone(sources);
    if (copy.profile.status === 'ready' && copy.profile.value.saved) copy.profile.value.saved.profile.retire.target_age = age;
    return judge(evaluateCareerScenario(copy, draft, { requirement: 'skip' }));
  };
  const first = at(original);
  if (first.verdict === 'blocked') return { status: 'blocked', message: first.issues.join(' ') || '条件未齐全。' };
  if (first.verdict === 'meets') return { status: 'already_met' };
  // Not a bisection: with a negative post-change contribution a later target can be worse.
  for (let age = original + 1; age <= last; age++) { const j = at(age); if (j.verdict === 'meets') return { status: 'found', age, delay_years: age - original }; if (j.verdict === 'blocked') return { status: 'blocked', message: j.issues.join(' ') || '条件未齐全。' }; }
  return { status: 'not_found', up_to_age: last };
}

/** Age in whole months at a YYYY-MM month, or null without a birth month. */
export function ageMonthsAt(sources: PlanningSources, month: string): number | null {
  const p = profileOf(sources);
  return p?.birth_month ? monthIndex(month) - monthIndex(p.birth_month) : null;
}
function profileOf(sources: PlanningSources) { return sources.profile.status === 'ready' ? sources.profile.value.saved?.profile ?? null : null; }

/** Fill only the still-unconfirmed contribution fields with the optimistic reading (contributions continue, nothing paid by the user),
 *  so an answer can be shown early. The caller must say so: this is a placeholder, replaced as soon as the real choices are filled. */
export function assumeInsurance(draft: CareerDraft): { draft: CareerDraft; changed: boolean } {
  const d = structuredClone(draft);
  let changed = false;
  for (const stage of [d.gap, d.recovery]) {
    if (stage.pension === null) { stage.pension = 'unchanged'; changed = true; }
    if (stage.insurance.monthly_cents === null) { stage.insurance = { monthly_cents: '0', included: true }; changed = true; }
  }
  return { draft: d, changed };
}

