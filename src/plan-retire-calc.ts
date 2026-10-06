// 退休与 FIRE 的输入汇总与计算（纯函数）：目标卡片、详情页与心愿详情共用，结果不存库。
import { fundsFrom } from './plan.ts';
import type { Income, PlanReview, ProfileState } from './plan.ts';
import { beijing, effectiveParams } from './plan-params.ts';
import { emergency, findFire, pensionTable, requiredAssets, sensitivity, traditional } from './plan-fire.ts';
import type { Ledger } from './plan-fire.ts';
import { ageMonthsAt, startAgeMonths } from './plan-pension.ts';
import type { Snapshot } from './wealth.ts';

export const SEARCH_CAP_YEARS = 70;

/** 可支配资产 = 最近完整盘点里计入的资产 − 负债 − 公积金类账户（锁定到领取年龄）。 */
export function disposable(snapshot: Snapshot | null): number | null {
  if (!snapshot) return null;
  let total = 0n;
  for (const e of snapshot.entries) {
    if (!e.counted || e.amount_cents === null) continue;
    if (e.kind === 'housing_fund') continue;
    total += (e.side === 'liability' ? -1n : 1n) * BigInt(e.amount_cents);
  }
  return Number(total);
}


/** 个人资料、最近完整盘点（null 表示还没有）与统计齐全时给出估算；缺什么在 missing 里说明。 */
export function buildRetireCalc(saved: NonNullable<ProfileState['saved']>, snapshot: Snapshot | null, review: PlanReview, incomes: Income[], today: string) {
    const p = saved.profile, r = p.retire, region = effectiveParams(beijing, p.overrides);
    const stats = review.stats;
    const { funds } = fundsFrom(snapshot?.entries ?? null, incomes);
    const now = ageMonthsAt(p.birth_month, today), start = startAgeMonths(p);
    const assets = disposable(snapshot);
    const saving = stats.median_monthly_saving_cents === null ? null : Number(stats.median_monthly_saving_cents);
    const derivedSpend = stats.median_monthly_spend_cents === null ? null : Number(stats.median_monthly_spend_cents);
    const spend = r.spend_cents !== null ? Number(r.spend_cents) : null;
    const missing: string[] = [];
    if (assets === null) missing.push('还没有完整盘点，算不出当前可支配资产。');
    if (saving === null) missing.push('还没有常态月储蓄：需要至少两次完整盘点，并在这段时间内记录月度收入。');
    if (spend === null) missing.push('请填写退休后月预算；历史支出仅作参考，不会自动成为退休预算。');
    if (missing.length || assets === null || saving === null || spend === null) return { p, r, now, start, missing, assets, saving, spend, derivedSpend, L: undefined, fire: undefined, trad: undefined, sens: undefined, emergency: undefined, required_now: undefined };
    const horizon = r.horizon_age * 12;
    const L: Ledger = { now_months: now, horizon_months: horizon, search_cap_months: Math.min(SEARCH_CAP_YEARS * 12, horizon), spend_cents: spend, assets_cents: assets, pension_at: pensionTable(p, region, today, funds, now, Math.max(now, start)) };
    return {
      p, r, now, start, missing, assets, saving, spend, derivedSpend, L,
      fire: findFire(L, saving, r.real_return_before_hundredths, r.real_return_after_hundredths),
      trad: traditional(L, start, saving, r.real_return_before_hundredths, r.real_return_after_hundredths),
      sens: sensitivity(L, saving),
      required_now: requiredAssets(L, now, r.real_return_after_hundredths),
      emergency: emergency(assets, spend, r.emergency_months),
    };
}
export type RetireCalc = ReturnType<typeof buildRetireCalc>;
