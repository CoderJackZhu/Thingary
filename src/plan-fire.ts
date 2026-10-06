// 退休与 FIRE 估算（PLANNING_DESIGN §6）：纯函数，全程「今天的钱」（实际口径），不碰数据库。
// 「未来缺口折现」代替 4% 法则：提前辞职的人先靠存款，到养老金起领年龄后才有养老金与公积金、
// 个人养老金的一次性解锁。输出是估算，内部用浮点，显示时取整到分。
import { project } from './plan-pension.ts';
import type { Funds, Profile } from './plan-pension.ts';
import type { RegionParams } from './plan-params.ts';

/** 在某个辞职年龄（月）下的养老金与锁定资金，均为今天的钱（分）。 */
export type Pension = { monthly_cents: number; lump_cents: number; unlock_age_months: number };

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

export type Fire = { offset_months: number; age_months: number; required_cents: number; assets_cents: number };

/** 逐月推演：每月加储蓄、按退休前实际收益率增长，第一个资产 ≥ 所需资产的月份就是 FIRE 日期。 */
export function findFire(L: Ledger, savingMonthly: number, rBeforeHundredths: number, rAfterHundredths: number): Fire | null {
  const g = monthly(rate(rBeforeHundredths));
  let assets = L.assets_cents;
  const last = Math.min(L.search_cap_months, L.horizon_months) - L.now_months;
  for (let t = 0; t <= last; t++) {
    if (t > 0) assets = assets * g + savingMonthly;
    const age = L.now_months + t;
    const required = requiredAssets(L, age, rAfterHundredths);
    if (assets >= required) return { offset_months: t, age_months: age, required_cents: required, assets_cents: assets };
  }
  return null;
}

export type Traditional = { age_months: number; assets_cents: number; required_cents: number; surplus_cents: number };

/** 传统模式：到法定领取年龄才退，看那时资产够不够（surplus 为负表示缺口）。 */
export function traditional(L: Ledger, startMonths: number, savingMonthly: number, rBeforeHundredths: number, rAfterHundredths: number): Traditional {
  const g = monthly(rate(rBeforeHundredths));
  const months = Math.max(0, startMonths - L.now_months);
  let assets = L.assets_cents;
  for (let t = 0; t < months; t++) assets = assets * g + savingMonthly;
  const required = requiredAssets(L, Math.max(startMonths, L.now_months), rAfterHundredths);
  return { age_months: Math.max(startMonths, L.now_months), assets_cents: assets, required_cents: required, surplus_cents: assets - required };
}

export const sensitivityFactors = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3];
export const sensitivityRates = [0, 100, 200, 300, 400];

export type Sensitivity = { factors: number[]; rates: number[]; cells: (number | null)[][] };

/** 行：月储蓄（当前的 70%–130%）；列：实际收益率（退休前后相同）；格子：FIRE 年龄（月），不可达为 null。 */
export function sensitivity(L: Ledger, savingMonthly: number): Sensitivity {
  return {
    factors: sensitivityFactors,
    rates: sensitivityRates,
    cells: sensitivityFactors.map(f => sensitivityRates.map(r => findFire(L, savingMonthly * f, r, r)?.age_months ?? null)),
  };
}

/** 当前可支配资产相当于几个月支出；低于应急金线时 below 为 true。 */
export function emergency(assetsCents: number, spendCents: number, months: number): { covered_months: number | null; below: boolean } {
  if (spendCents <= 0) return { covered_months: null, below: false };
  const covered = assetsCents / spendCents;
  return { covered_months: covered, below: covered < months };
}

/** 用养老金计算器给每个候选辞职年龄（月）算一次养老金与解锁额，并缓存。 */
export function pensionTable(profile: Profile, region: RegionParams, today: string, funds: Funds, fromMonths: number, toMonths: number): (ageMonths: number) => Pension {
  const projected = new Map<number, { monthly_cents: number; lump_cents: number; start: number }>();
  const cache = new Map<number, Pension>();
  return (age: number) => {
    let hit = cache.get(age);
    if (!hit) {
      // 辞职晚于领取年龄时缴费止于领取年龄，养老金与锁定资金同领取年龄辞职；解锁不早于辞职当月。
      const a = Math.min(Math.max(age, fromMonths), toMonths);
      let r = projected.get(a);
      if (!r) {
        const p = project(profile, region, today, a, funds);
        r = { monthly_cents: p.total_today_cents, lump_cents: p.pots_today_cents, start: p.start_age_months };
        projected.set(a, r);
      }
      hit = { monthly_cents: r.monthly_cents, lump_cents: r.lump_cents, unlock_age_months: Math.max(r.start, age) };
      cache.set(age, hit);
    }
    return hit;
  };
}
