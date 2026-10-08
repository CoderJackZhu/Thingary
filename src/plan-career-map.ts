// Window map: when the high-income window closes, how long a gap can be survived, and how long the window must last.
// A thin read-only layer over evaluateCareerScenario. It predicts nothing: every number is "under these conditions".
import { prepareBasicPlan } from './plan-basic.ts';
import type { PlanningSources } from './plan-basic-contract.ts';
import { monthIndex } from './plan-events.ts';
import { evaluateCareerScenario } from './plan-career.ts';
import { careerMonth, validCareerAmount } from './plan-career-contract.ts';
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
  return evaluateCareerScenario(sources, d);
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
  | { status: 'not_reachable' | 'until_target'; message: string }
  | { status: 'not_applicable' | 'blocked'; message: string };
const bad = (status: 'not_applicable' | 'blocked', message: string): MinWindow => ({ status, message });

/** The fewest more months of the current contribution after which the goal holds even if the window closes then
 *  (draft supplies the gap and the post-window contribution). Needs the current contribution above the post-window one,
 *  otherwise a later close cannot only help and the search is not defined. */
export function minWindow(sources: PlanningSources, draft: CareerDraft): MinWindow {
  const span = careerSpan(sources), current = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile.retire.basic?.contribution.monthly_cents ?? null : null;
  if (!span) return bad('blocked', '请先确认通用资料、出生年月和资金截至日。');
  if (!validCareerAmount(current, true)) return bad('blocked', '现在每月能攒多少还不知道，不能比较窗口。');
  if (!validCareerAmount(draft.recovery.monthly_cents, true)) return bad('blocked', '请先填关闭后每月能攒多少。');
  if (Number(draft.recovery.monthly_cents) >= Number(current)) return bad('not_applicable', '关闭后每月能攒的钱不低于现在，窗口关闭不会变差。');
  const gap = draft.gap_months ?? 0, hi = span.target - 1 - gap;
  if (hi < span.now) return bad('blocked', '空窗加恢复超出原目标，没有可比较的关闭月。');
  // The window never closing is the baseline: if even that fails, no window length helps.
  const never = judge(run(sources, draft, { close: span.now, gap: 0, recovery: current }));
  if (never.verdict === 'blocked') return bad('blocked', never.issues.join(' ') || '条件未齐全。');
  if (never.verdict === 'short') return { status: 'not_reachable', message: '窗口一直持续到目标，原目标也不满足；这不是窗口长度的问题。' };
  const at = (m: number) => judge(run(sources, draft, { close: m })).verdict;
  const first = at(span.now);
  if (first === 'blocked') return bad('blocked', '关闭后的条件未齐全。');
  if (first === 'meets') return { status: 'already_met' };
  if (at(hi) !== 'meets') return { status: 'until_target', message: '窗口要一直持续到目标月：连提前一个月关闭都不满足。' };
  let lo = span.now;
  let up = hi;
  while (up - lo > 1) { const mid = Math.floor((lo + up) / 2); if (at(mid) === 'meets') up = mid; else lo = mid; }
  return { status: 'found', months: up - span.now, close_month: careerMonth(up) };
}

export type MaxGap =
  | { status: 'found'; months: number; limit: Reason | 'end' }
  | { status: 'none'; reason: Reason | null }
  | { status: 'not_applicable' | 'blocked'; message: string };

/** The longest gap (months) after the close month that still keeps funds above zero and the goal met.
 *  Needs the gap's net cash flow to be no better than the post-gap contribution, otherwise a longer gap could help. */
export function maxGap(sources: PlanningSources, draft: CareerDraft): MaxGap {
  const span = careerSpan(sources);
  if (!span) return { status: 'blocked', message: '请先确认通用资料、出生年月和资金截至日。' };
  if (!draft.transition_month || !validCareerAmount(draft.recovery.monthly_cents, true)) return { status: 'blocked', message: '请先填变化月份和关闭后每月能攒多少。' };
  if (validCareerAmount(draft.gap.income_cents) && validCareerAmount(draft.gap.spend_cents) && Number(draft.gap.income_cents) - Number(draft.gap.spend_cents) > Number(draft.recovery.monthly_cents)) return { status: 'not_applicable', message: '空窗期的净流入高于恢复后，拉长空窗不会变差。' };
  const close = monthIndex(draft.transition_month), cap = span.target - close - 1;
  if (cap < 0) return { status: 'blocked', message: '变化月须早于原目标月。' };
  const at = (g: number) => judge(run(sources, draft, { gap: g }));
  const zero = at(0);
  if (zero.verdict === 'blocked') return { status: 'blocked', message: zero.issues.join(' ') || '条件未齐全。' };
  if (zero.verdict === 'short') return { status: 'none', reason: zero.reason };
  // A blocked gap (e.g. the payment check cannot run) is not a short one; never read it as "this long fails".
  const blockedAt = (g: number) => { const j = at(g); return j.verdict === 'blocked' ? { status: 'blocked' as const, message: j.issues.join(' ') || '条件未齐全。' } : null; };
  if (cap >= 1) { const b = blockedAt(1); if (b) return b; }
  const top = at(cap);
  if (top.verdict === 'blocked') return { status: 'blocked', message: top.issues.join(' ') || '条件未齐全。' };
  if (top.verdict === 'meets') return { status: 'found', months: cap, limit: 'end' };
  let lo = 0, up = cap;
  while (up - lo > 1) { const mid = Math.floor((lo + up) / 2), j = at(mid); if (j.verdict === 'blocked') return { status: 'blocked', message: j.issues.join(' ') || '条件未齐全。' }; if (j.verdict === 'meets') lo = mid; else up = mid; }
  return { status: 'found', months: lo, limit: at(lo + 1).reason ?? 'goal' };
}

export type PensionChoice = { label: string; pension: CareerPension; /** Monthly cash the user pays for this choice (bill amount). null = not entered yet; it is never read as zero. */ cash_cents: string | null; /** When set, the row is not evaluated and shows this reason (e.g. a custom base not entered yet). */ blocked?: string };
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
  d[stage].pension = structuredClone(choice.pension);
  d[stage].insurance = { monthly_cents: choice.cash_cents, included: false };
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
    return judge(evaluateCareerScenario(copy, draft));
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
