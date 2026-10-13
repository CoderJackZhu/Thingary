import type { BasicCapabilities } from './plan-basic-contract.ts';
import { monthIndexV1, monthTextV1 } from './plan-simplified.ts';

/** Mirrors `goal_progress::Point`: every figure may be unknown, and unknown is never zero. */
export type GoalProgressPoint = {
  mode: 'fire' | 'traditional';
  target_month: string | null;
  available_cents: string | null;
  required_monthly_cents: string | null;
  entered_monthly_cents: string | null;
  success: boolean | null;
  shortfall_at_goal_cents: string | null;
  predicted_retire_month: string | null;
  has_open_items: boolean;
};
export type GoalProgressEntry = { snapshot_id: string; date: string; recorded_on: string; point: GoalProgressPoint };

/**
 * The conclusion the goal page shows today, as a point to keep. Only a live
 * check-in start counts: a hand-entered simulation start says nothing about a
 * check-in. Returns null when nothing was calculated.
 */
export function goalProgressPoint(caps: BasicCapabilities, mode: string, targetMonth: string | null, enteredMonthlyCents: string | null): GoalProgressPoint | null {
  const funds = caps.funds.status === 'ready' && caps.funds.value.kind === 'live' ? caps.funds.value : null;
  if (!funds) return null;
  const req = caps.requirement.status === 'ready' ? caps.requirement.value : null;
  const pred = caps.prediction.status === 'ready' ? caps.prediction.value : null;
  const required = req && 'monthly_cents' in req.set ? req.set.monthly_cents : null;
  if (required === null && !pred) return null;
  const retire = pred?.projection.retire_month ?? null;
  const retireMonth = pred && retire !== null && pred.plan.anchor_date ? monthTextV1(monthIndexV1(pred.plan.anchor_date) + retire - pred.plan.now_months) : null;
  return {
    mode: mode === 'fire' ? 'fire' : 'traditional',
    target_month: targetMonth,
    available_cents: funds.available_cents,
    required_monthly_cents: required,
    entered_monthly_cents: enteredMonthlyCents,
    success: pred ? pred.outcome.success : null,
    shortfall_at_goal_cents: pred && !pred.outcome.funded_at_goal ? String(Math.round(pred.outcome.shortfall_at_goal)) : null,
    predicted_retire_month: mode === 'fire' ? retireMonth : null,
    has_open_items: (caps.annotations ?? []).some(a => a.effect !== 'none'),
  };
}

/** What the saved estimate meant on that day, in the words of the goal page. */
export function goalProgressVerdict(p: GoalProgressPoint, money: (cents: string) => string): string {
  if (p.success === null) return '当时没有每月能存的估计，只算了需要多少';
  if (p.mode === 'fire') return p.predicted_retire_month ? `预计 ${p.predicted_retire_month} 退休` : '规划终点前尚未达成';
  if (p.success) return '按当时投入，目标期间可覆盖';
  return p.shortfall_at_goal_cents ? `按当时投入，目标年龄时还差 ${money(p.shortfall_at_goal_cents)}` : '按当时投入，尚未满足完整目标';
}

const diff = (a: string | null, b: string | null): number | null => a === null || b === null ? null : Number(b) - Number(a);
/** Change between two consecutive points, only for figures known on both days. */
export function goalProgressChange(previous: GoalProgressEntry, latest: GoalProgressEntry, money: (cents: string) => string): string {
  const parts: string[] = [];
  const need = diff(previous.point.required_monthly_cents, latest.point.required_monthly_cents);
  if (need !== null && need !== 0) parts.push(`需要每月存${need < 0 ? '少了' : '多了'} ${money(String(Math.abs(need)))}`);
  const funds = diff(previous.point.available_cents, latest.point.available_cents);
  if (funds !== null && funds !== 0) parts.push(`可用资金${funds > 0 ? '增加' : '减少'} ${money(String(Math.abs(funds)))}`);
  return parts.length ? `较上次盘点（${previous.date}）：${parts.join('，')}。` : `较上次盘点（${previous.date}）没有可比的变化。`;
}
