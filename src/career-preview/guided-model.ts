// Plain-language layer for the guided career page: defaults, sentences and "what would help" levers.
// No new calculation: everything comes from maxGap / minWindow / evaluateCareerScenario on the scoped sources.
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft, CareerEvaluation } from '../plan-career-contract.ts';
import { careerDraft } from './fixtures.ts';
import { incomeDraft } from './income-scope.ts';
import type { IncomeDraft } from './income-scope.ts';
import { ageMonthsAt, maxGap } from '../plan-career-map.ts';
import { historyHints } from '../planning-basic-defaults.ts';
import { careerMonth } from '../plan-career-contract.ts';
import type { MaxGap, MinWindow, Reason } from '../plan-career-map.ts';

export const yuan = (cents: string | number) => `¥${(Number(cents) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
export type Tone = 'good' | 'warn' | 'bad' | 'wait';
export type Say = { tone: Tone; headline: string; sub: string };

/** Example numbers to start from (clearly labelled in the page); social insurance is counted inside the spending figures. */
export function guidedDraft(): CareerDraft {
  const d = careerDraft();
  for (const stage of [d.gap, d.recovery]) { stage.pension = 'unchanged'; stage.insurance = { monthly_cents: '0', included: true }; }
  d.gap.costs = []; d.recovery.costs = [];
  d.recovery.monthly_cents = '600000';
  return d;
}
/** Conservative starting assumption, shown on the page and changeable: no state pension, no housing fund or personal pension. */
export const guidedIncome = (sources: PlanningSources): IncomeDraft => ({ ...incomeDraft(sources), mode: 'excluded', excludePools: true });

const reasonPlain = (r: Reason | null, age: number | null): string =>
  r === 'goal' ? `到${age ?? '目标'}岁退休时，钱就不够退休后花了` : r === 'cash' ? '不工作期间钱就先花光了' : r === 'prefix' ? '前面已经有一笔付不起，后面再多攒也补不回来' : '条件还没填完整';

export function sayRest(x: MaxGap, age: number | null): Say {
  if (x.status === 'found' && x.ranges) return { tone: 'warn', headline: `最长能撑 ${x.months} 个月，但不是越短越稳`, sub: `可行的长度只有：${x.ranges.map(r => r.from === r.to ? `${r.from} 个月` : `${r.from}–${r.to} 个月`).join('、')}。更短的反而不行，通常是补助、补偿金或缴费年限造成的。` };
  if (x.status === 'found' && x.limit === 'end') return { tone: 'good', headline: '一直不工作到退休前，钱也够', sub: `在这些条件下，一直到你定的${age ?? ''}岁退休前都撑得住。` };
  if (x.status === 'found') return { tone: x.months >= 12 ? 'good' : 'warn', headline: `最多能撑 ${x.months} 个月`, sub: `再长，${reasonPlain(x.limit as Reason, age)}。` };
  if (x.status === 'none') return { tone: 'bad', headline: '按这个条件，保不住原来的退休目标', sub: `就算不空窗也不行：${reasonPlain(x.reason, age)}。可以试试：找到工作后多攒一点、晚几年退休，或把退休后的花销降下来。` };
  return { tone: 'wait', headline: '还算不出来', sub: x.message };
}

export function sayLower(x: MinWindow, sources: PlanningSources): Say {
  if (x.status === 'found') {
    const m = ageMonthsAt(sources, x.close_month);
    return { tone: 'good', headline: `至少做到 ${x.close_month}${m === null ? '' : `（${Math.floor(m / 12)} 岁）`}之前`, sub: `再高收入地做约 ${Math.floor(x.months / 12)} 年 ${x.months % 12} 个月，之后每月只攒这么多也不影响退休目标。` };
  }
  if (x.status === 'already_met') return { tone: 'good', headline: '现在就可以', sub: '按这个“之后每月能攒多少”，现在降下来，退休目标也保得住。' };
  if (x.status === 'not_reachable') return { tone: 'bad', headline: '做多久都不够', sub: x.message };
  return { tone: 'wait', headline: '还算不出来', sub: x.message };
}

/** Question 3: what must be saved each month after the change, set against the user's own estimate. */
export function saySwitch(ev: CareerEvaluation, estimate: string | null): Say {
  const r = ev.requirement;
  if (r.status === 'blocked') return { tone: 'wait', headline: '还算不出来', sub: r.issues.map(i => i.message).join(' ') };
  const v = r.value;
  if (v.status === 'found') {
    const need = Number(v.monthly_cents), have = estimate !== null && /^-?\d+$/.test(estimate) ? Number(estimate) : null;
    const cmp = have === null ? '你还没填估计每月能攒多少，填了就能对比。' : have >= need ? `你估计每月能攒 ${yuan(have)}，够。` : `你估计每月能攒 ${yuan(have)}，每月还差 ${yuan(need - have)}。`;
    return { tone: have === null ? 'warn' : have >= need ? 'good' : 'bad', headline: `每月至少要攒 ${yuan(need)}`, sub: `从找到新工作那个月起，一直攒到退休年龄，才能保住原来的退休目标。${cmp}` };
  }
  if (v.status === 'no_positive_contribution') return { tone: 'good', headline: '不用再攒，现有的钱就够', sub: '按这些条件，找到新工作后即使不攒，退休目标也保得住。' };
  if (v.status === 'search_not_found') return { tone: 'bad', headline: '怎么攒都不够', sub: '在合理的月储蓄范围内也达不到，需要晚退休或降低退休后的花销。' };
  return { tone: 'bad', headline: '这个条件下后面补不回来', sub: 'message' in v ? v.message : '空窗期间已经有付不起的月份，之后再多攒也补不回来。' };
}

export type Lever = { label: string; text: string };
const months = (x: MaxGap) => (x.status === 'found' ? x.months : x.status === 'none' ? 0 : null);
/** What buys extra months of rest: each row changes exactly one thing and reruns the same search. */
export function restLevers(sources: PlanningSources, draft: CareerDraft): Lever[] {
  const base = maxGap(sources, draft), b = months(base);
  if (b === null) return [];
  const out: Lever[] = [];
  const row = (label: string, x: MaxGap) => { const m = months(x); out.push({ label, text: m === null ? '算不出' : m === 0 ? '仍然保不住' : b === 0 ? `能撑 ${m} 个月` : m > b ? `多撑约 ${m - b} 个月（共 ${m} 个月）` : m === b ? '没有变化' : `少 ${b - m} 个月` }); };
  const up = structuredClone(draft); if (up.recovery.monthly_cents !== null) { up.recovery.monthly_cents = String(Number(up.recovery.monthly_cents) + 100_000); row('找到新工作后，每月多攒 ¥1,000', maxGap(sources, up)); }
  const less = structuredClone(draft); if (less.gap.spend_cents !== null && Number(less.gap.spend_cents) >= 100_000) { less.gap.spend_cents = String(Number(less.gap.spend_cents) - 100_000); row('不工作期间，每月少花 ¥1,000', maxGap(sources, less)); }
  const later = structuredClone(sources);
  if (later.profile.status === 'ready' && later.profile.value.saved?.profile.retire.target_age != null) { later.profile.value.saved.profile.retire.target_age += 1; row('退休晚一年', maxGap(later, draft)); }
  return out;
}

export type GuidedDefaults = { draft: CareerDraft; income: IncomeDraft; /** Where the starting figures came from, for the on-page note. */ from: { spend: 'history' | null; recovery: 'current' | null } };
const monthOf = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

/** Starting values for real facts. Nothing is invented: the monthly spend comes from past inventories only when there are enough of them,
 *  "savings after the change" starts equal to today's savings (so an answer shows and can be lowered), the stage costs follow the
 *  treatment already confirmed in the plan, and pension / pools start as the visible conservative "not counted". */
export function realGuidedDefaults(sources: PlanningSources, today: string): GuidedDefaults {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile ?? null : null;
  const b = p?.retire.basic ?? null;
  const d = guidedDraft();
  d.transition_month = careerMonth(monthOf(today) + 1);
  d.gap_months = 6; d.gap.income_cents = '0'; d.gap.spend_cents = null; d.recovery.monthly_cents = null;
  const costs = structuredClone(b?.contribution_costs ?? []);
  d.gap.costs = structuredClone(costs); d.recovery.costs = structuredClone(costs);
  const hist = historyHints(sources.review.status === 'ready' ? sources.review.value : null);
  const from: GuidedDefaults['from'] = { spend: null, recovery: null };
  if (hist.spend !== null) { d.gap.spend_cents = hist.spend; from.spend = 'history'; }
  const cur = b?.contribution.monthly_cents ?? null;
  if (cur !== null && /^-?\d+$/.test(cur) && Number(cur) >= 0) { d.recovery.monthly_cents = cur; from.recovery = 'current'; }
  return { draft: d, income: guidedIncome(sources), from };
}
