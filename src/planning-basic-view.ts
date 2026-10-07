// Display-only helpers for the basic planning UI. No ledger, search or storage logic lives here:
// every number comes from the shared contract (capabilities / saved inputs) and is only worded.
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
export const ownerAction: Record<PlanningMissing['owner'], string> = { basic: '补充目标与预算', pension: '填写养老金事实', funds: '核对资金范围', events: '核对大额计划', budget: '核对预算明细', service: '重新读取' };

/** The first thing a person can do about a blocked capability, grouped by owner so each owner gets one action. */
export function missingOwners(missing: PlanningMissing[]): PlanningMissing['owner'][] {
  return [...new Set(missing.map(m => m.owner))];
}

export type Tone = 'good' | 'warn' | 'plain';
/** Wording for each real requirement status. Candidates are never contributions; `null` is never shown as 0. */
export function requirementLine(r: RequirementResult, fmt: (cents: string) => string): { text: string; tone: Tone } {
  switch (r.status) {
    case 'found': return { text: `每月 ${fmt(r.monthly_cents)}`, tone: 'plain' };
    case 'no_positive_contribution': return { text: '无需新增正投入', tone: 'good' };
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
export const SAVE_CONTRIBUTION_HINT = '保存预计投入后可查看';

export const returnDropText = (before: number, after: number) => `收益各降 2 个百分点（退休前 ${(before / 100).toFixed(2)}% / 退休后 ${(after / 100).toFixed(2)}%）`;

/** Which setup step owns a missing item: funds start and retirement income live in step 2, everything else in step 1. */
export const setupStepFor = (owner: PlanningMissing['owner'], field = ''): 0 | 1 => (owner === 'funds' || field.startsWith('basic.start') || field.startsWith('basic.retirement_income') ? 1 : 0);
