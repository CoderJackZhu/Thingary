// Display-only helpers for the basic planning UI. No ledger, search or storage logic lives here:
// every number comes from the shared contract (capabilities / saved inputs) and is only worded.
import { durationText } from './plan-view.ts';
import type { RunwayResult } from './plan-runway.ts';
import type { BasicCapabilities, BasicInputs, PlanningMissing, ProfileState, RequirementResult, RetireInputs } from './plan.ts';

export type PlanMode = 'none' | 'legacy' | 'basic';
type Saved = ProfileState['saved'];

/** A saved profile without `basic` is the original plan only when someone actually set one up; a pension-only profile is not. */
export function hasLegacyPlan(r: RetireInputs): boolean {
  return !!r.setup_completed || r.saving_phases.length > 0 || r.route_id !== null || r.spend_cents !== null || r.spend_items.length > 0 || r.income_items.length > 0 || r.life_events.length > 0;
}
export function modeOf(saved: Saved): PlanMode {
  if (!saved) return 'none';
  const r = saved.profile.retire;
  return r.basic ? 'basic' : hasLegacyPlan(r) ? 'legacy' : 'none';
}

export type ContributionState = 'unknown' | 'zero' | 'positive' | 'negative';
/** Unknown is `null`; zero is an explicit "0". Never test the amount for truthiness. */
export function amountState(cents: string | null): ContributionState {
  if (cents === null) return 'unknown';
  const n = BigInt(cents);
  return n === 0n ? 'zero' : n > 0n ? 'positive' : 'negative';
}
export const contributionState = (b: BasicInputs | undefined): ContributionState => amountState(b?.contribution.monthly_cents ?? null);

export const ownerLabel: Record<PlanningMissing['owner'], string> = { basic: '目标与预算', pension: '养老金事实', funds: '资金范围', events: '大额计划', budget: '预算明细', service: '重新读取' };
export const ownerAction: Record<PlanningMissing['owner'], string> = { basic: '填写退休年龄和生活费', pension: '填写社保资料', funds: '选择这次用哪些钱', events: '核对买房买车等计划', budget: '确认这些费用怎么算', service: '重新读取' };

/** The first thing a person can do about a blocked capability, grouped by owner so each owner gets one action. */
export function missingOwners(missing: PlanningMissing[]): PlanningMissing['owner'][] {
  return [...new Set(missing.map(m => m.owner))];
}

/** Plain-language guidance for missing inputs; calculation constraints and read errors retain their exact message. */
export function missingText(m: PlanningMissing): string {
  if (m.kind === 'constraint' || m.kind === 'read_error') return m.message;
  const text: Record<string, string> = {
    PROFILE_UNKNOWN: '先设置一个退休目标，已有资料会保留。',
    BIRTH_UNKNOWN: '还需要你的出生年月，才能算出退休前还有多少时间。',
    TARGET_UNKNOWN: '你想在几岁退休？先选一个年龄，以后可以改。',
    BUDGET_UNKNOWN: '退休后每月大约花多少钱？按现在的物价填生活费总额。',
    START_UNKNOWN: '还需要现在可用的金额，以及这笔金额是哪天的。',
    INCOME_MODE_UNKNOWN: '这次要不要算养老金等退休收入？也可以选择先不算。',
    CONTRIBUTION_UNKNOWN: '还没估计每月能存多少钱，先看目标需要的钱也可以。',
    PENSION_FACTS_UNKNOWN: '选择了养老金估算，还需要补齐社保资料。',
  };
  if (m.code === 'COST_SCOPE_UNKNOWN' && m.field.startsWith('basic.')) return m.field.includes('contribution')
    ? '还有费用没核对：每月存钱的金额是否已经扣除了它？'
    : '还有费用没核对：上面的生活费是否已经包含了它？';
  return text[m.code] ?? m.message;
}
export function missingAction(m: PlanningMissing): string {
  const actions: Record<string, string> = {
    birth_month: '填写出生年月', target_age: '选择想退休的年龄', spend_cents: '填写每月生活费',
    'basic.start': '填写现在可用的钱', 'basic.retirement_income.mode': '选择是否计入养老金',
    'basic.pension_contributions': '设置以后怎样缴社保',
  };
  return actions[m.field] ?? ownerAction[m.owner];
}

export type Tone = 'good' | 'warn' | 'plain';
/** Wording for each real requirement status. Candidates are never contributions; `null` is never shown as 0. */
export function requirementLine(r: RequirementResult, fmt: (cents: string) => string): { text: string; tone: Tone } {
  switch (r.status) {
    case 'found': return { text: `每月 ${fmt(r.monthly_cents)}`, tone: 'plain' };
    case 'no_positive_contribution': return { text: '按这些条件，不用再额外存钱', tone: 'good' };
    case 'search_not_found': return { text: `在每月 ${fmt(r.search_limit_cents)} 的搜索上限内没有找到可行金额`, tone: 'warn' };
    case 'payment_constraint': return { text: `当前付款安排下无法满足：${r.message}`, tone: 'warn' };
    case 'not_applicable': return { text: `不适用：${r.message}`, tone: 'plain' };
    case 'out_of_bounds': return { text: `超出可计算范围：${r.message}`, tone: 'warn' };
  }
}

export const terminalText = { surplus: '规划终点仍有余量', no_margin: '规划终点恰好为 0：只覆盖到所选终点，没有余量', gap: '规划终点前出现缺口' } as const;

/** Prediction waits on an explicit contribution only when the contract says so. */
export const needsContribution = (caps: BasicCapabilities) => caps.prediction.status === 'blocked' && caps.prediction.missing.some(m => m.code === 'CONTRIBUTION_UNKNOWN');
export const predictionReady = (caps: BasicCapabilities) => caps.prediction.status === 'ready';
/** Outputs that need a saved or temporary explicit contribution: projected age/date, countdown, charts, simulation share, future balances. */
export const showPredictionOutputs = predictionReady;
export const SAVE_CONTRIBUTION_HINT = '填好每月能存多少钱后，可查看影响';

export const returnDropText = (before: number, after: number) => `收益各降 2 个百分点（退休前 ${(before / 100).toFixed(2)}% / 退休后 ${(after / 100).toFixed(2)}%）`;
export const returnBasisText = (before: number, after: number) => `退休前 ${(before / 100).toFixed(2)}% / 退休后 ${(after / 100).toFixed(2)}%`;
export const returnRiseText = (before: number, after: number) => `收益各升 2 个百分点（退休前 ${(before / 100).toFixed(2)}% / 退休后 ${(after / 100).toFixed(2)}%）`;

/** Which setup step owns a missing item: funds, retirement income and future pension payments live in step 2; pre-retirement costs live in confirmation. */
export const setupStepFor = (owner: PlanningMissing['owner'], field = ''): 0 | 1 | 3 => field.startsWith('basic.contribution_costs') ? 3 : (owner === 'funds' || field.startsWith('basic.start') || field.startsWith('basic.retirement_income') || field.startsWith('basic.pension_contributions') ? 1 : 0);

/** Current cash flow is independent of long-term contributions. A payment gap is not exhaustion. */
export function runwayLines(r: RunwayResult, floor: { set: boolean; cents: string }, fmt: (cents: string) => string): { main: string; floor: string | null; tone: Tone } {
  if (r.status === 'invalid') return { main: r.message, floor: null, tone: 'warn' };
  const n = r.status === 'payment_gap' ? r.covered_months : r.checked_months;
  const main = r.status === 'not_reached'
    ? `按所填收支，检查的 ${n} 个月内可完整支付开销；不保证未来安全。`
    : n === 0 ? `月初资金不足以支付当月开销，尚余 ${fmt(String(r.remaining_cents))}：月底到账补不上月初的付款。`
    : `按这个状态持续，可完整支付 ${n} 个月（约 ${durationText(n)}）；第 ${n + 1} 个月月初尚余 ${fmt(String(r.remaining_cents))}，不够支付当月开销。`;
  const m = r.floor_month;
  const line = !floor.set ? '没有设置资金底线，只检查支付能力，不代表资金安全。'
    : m === 0 ? `起点资金已不高于底线 ${fmt(floor.cents)}，差 ${fmt(String(r.floor_gap_cents ?? 0))}。`
    : m !== null ? `第 ${m} 个月月初付款后触及底线 ${fmt(floor.cents)} 或以下，月底到账不抵消这次触底。`
    : r.status === 'payment_gap' ? '已完整支付的月份内未触及底线；无法支付之后的余额不再推演。'
    : `检查的 ${r.checked_months} 个月内未触及底线。`;
  return { main, floor: line, tone: m !== null || (r.status === 'payment_gap' && n < 6) ? 'warn' : 'plain' };
}
