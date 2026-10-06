// 旧的单预算退休引擎（逐月、闭式年金）：只作 plan-ledger 的对照基准，不随应用发布。
// 单个支出桶、没有收入流时，新引擎的所需资产、FIRE 月份与传统模式盈亏必须与它一致（tests/plan-ledger.test.mjs）。
import type { Pension, Spend } from '../src/plan-fire.ts';

export type Ledger = {
  /** 现在的年龄、规划终点与搜索上限，单位月。 */
  now_months: number;
  horizon_months: number;
  search_cap_months: number;
  /** 退休后每月支出（今天的钱，分）。 */
  spend_cents: number;
  /** 当前可支配资产（分）。 */
  assets_cents: number;
  pension_at: (ageMonths: number) => Pension;
};

const monthly = (annual: number) => (1 + annual) ** (1 / 12);
const rate = (hundredths: number) => hundredths / 10000;

/** 期末付款年金现值系数：Σ_{k=1..n} (1+i)^-k；i 为月利率。 */
export function annuity(n: number, i: number): number {
  if (n <= 0) return 0;
  return i === 0 ? n : (1 - (1 + i) ** -n) / i;
}

/** 在 a（月）辞职所需资产：Σ[支出 − 养老金·1(已起领) − 一次性解锁]，按退休后实际收益率折现。 */
export function requiredAssets(L: Ledger, aMonths: number, rAfterHundredths: number): number {
  const n = L.horizon_months - aMonths;
  if (n <= 0) return 0;
  const i = monthly(rate(rAfterHundredths)) - 1;
  const pension = L.pension_at(aMonths);
  const d = Math.max(0, pension.unlock_age_months - aMonths);
  const spend = L.spend_cents * annuity(n, i);
  const received = pension.monthly_cents * (annuity(n, i) - annuity(Math.min(d, n), i));
  const lump = d <= n ? pension.lump_cents * (1 + i) ** -d : 0;
  return Math.max(0, spend - received - lump);
}

/** 带日期的一次性支出（今天的钱，分）：offset_months 为距现在的月数，0 表示当月。 */
export type Spend = { offset_months: number; cents: number };
const spendByMonth = (spends: Spend[]) => { const m = new Map<number, number>(); for (const e of spends) m.set(e.offset_months, (m.get(e.offset_months) ?? 0) + e.cents); return m; };

export type Fire = { offset_months: number; age_months: number; required_cents: number; assets_cents: number };

/** 逐月推演：每月加储蓄、按退休前实际收益率增长，第一个资产 ≥ 所需资产的月份就是 FIRE 日期。 */
export function findFire(L: Ledger, savingMonthly: number, rBeforeHundredths: number, rAfterHundredths: number, spends: Spend[] = []): Fire | null {
  const g = monthly(rate(rBeforeHundredths));
  const out = spendByMonth(spends);
  let assets = L.assets_cents;
  const last = Math.min(L.search_cap_months, L.horizon_months) - L.now_months;
  for (let t = 0; t <= last; t++) {
    if (t > 0) assets = assets * g + savingMonthly;
    assets -= out.get(t) ?? 0;
    const age = L.now_months + t;
    const required = requiredAssets(L, age, rAfterHundredths);
    if (assets >= required) return { offset_months: t, age_months: age, required_cents: required, assets_cents: assets };
  }
  return null;
}

export type Traditional = { age_months: number; assets_cents: number; required_cents: number; surplus_cents: number };

/** 传统模式：到法定领取年龄才退，看那时资产够不够（surplus 为负表示缺口）。 */
export function traditional(L: Ledger, startMonths: number, savingMonthly: number, rBeforeHundredths: number, rAfterHundredths: number, spends: Spend[] = []): Traditional {
  const g = monthly(rate(rBeforeHundredths));
  const out = spendByMonth(spends);
  const months = Math.max(0, startMonths - L.now_months);
  let assets = L.assets_cents - (out.get(0) ?? 0);
  for (let t = 1; t <= months; t++) assets = assets * g + savingMonthly - (out.get(t) ?? 0);
  const required = requiredAssets(L, Math.max(startMonths, L.now_months), rAfterHundredths);
  return { age_months: Math.max(startMonths, L.now_months), assets_cents: assets, required_cents: required, surplus_cents: assets - required };
}

