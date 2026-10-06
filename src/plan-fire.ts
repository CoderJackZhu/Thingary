// 退休估算的小工具（PLANNING_DESIGN §6）：养老金表、进展与应急金线。主体计算在 plan-ledger.ts。
// 「未来缺口折现」代替 4% 法则：提前辞职的人先靠存款，到养老金起领年龄后才有养老金与公积金、
// 个人养老金的一次性解锁。输出是估算，内部用浮点，显示时取整到分。
import { project } from './plan-pension.ts';
import type { Employment, Funds, Profile } from './plan-pension.ts';
import type { RegionParams } from './plan-params.ts';

/** 在某个辞职年龄（月）下的养老金与锁定资金，均为今天的钱（分）。 */
export type Pension = {
  monthly_cents: number; lump_cents: number; unlock_age_months: number;
  /** 缴费年限不足最低要求时为 false，short_months 是还差的月数；不足时 monthly_cents 为 0。缺省视为满足。 */
  eligible?: boolean; short_months?: number;
};

/** 带日期的一次性支出（今天的钱，分）：offset_months 为距现在的月数，0 表示当月。 */
export type Spend = { offset_months: number; cents: number };

/** 进展：当前可支配资产 ÷ 今天就辞职所需资产，万分比，限定在 0–100%；所需为 0 时视为 100%。 */
export const progressHundredths = (assets: number, required: number): number => (required <= 0 ? 10000 : Math.round(Math.min(1, Math.max(0, assets / required)) * 10000));

/** 距离达成还有多久：「已经够了」「7 个月」「12 年 4 个月」。 */
export function monthsLeftText(months: number): string {
  if (months <= 0) return '已经够了';
  const y = Math.floor(months / 12), m = months % 12;
  return y === 0 ? `${m} 个月` : m === 0 ? `${y} 年` : `${y} 年 ${m} 个月`;
}

/** 当前可支配资产相当于几个月支出；低于应急金线时 below 为 true。 */
export function emergency(assetsCents: number, spendCents: number, months: number): { covered_months: number | null; below: boolean } {
  if (spendCents <= 0) return { covered_months: null, below: false };
  const covered = assetsCents / spendCents;
  return { covered_months: covered, below: covered < months };
}

/** 用养老金计算器给每个候选辞职年龄（月）算一次养老金与解锁额，并缓存。 */
export function pensionTable(profile: Profile, region: RegionParams, today: string, funds: Funds, fromMonths: number, toMonths: number, employment: Employment[] = []): (ageMonths: number) => Pension {
  const projected = new Map<number, { monthly_cents: number; lump_cents: number; start: number; short: number }>();
  const cache = new Map<number, Pension>();
  return (age: number) => {
    let hit = cache.get(age);
    if (!hit) {
      // 辞职晚于领取年龄时缴费止于领取年龄，养老金与锁定资金同领取年龄辞职；解锁不早于辞职当月。
      const a = Math.min(Math.max(age, fromMonths), toMonths);
      let r = projected.get(a);
      if (!r) {
        const p = project(profile, region, today, a, funds, employment);
        // 年限不足不能按月领基本养老金（养老金页仍按公式显示并提示）：月额按 0 计，个人账户余额近似为一次性领回；续缴或补缴凑够年限另算。
        const short = p.eligible ? 0 : p.required_months - p.total_paid_months;
        r = p.eligible
          ? { monthly_cents: p.total_today_cents, lump_cents: p.pots_today_cents, start: p.start_age_months, short }
          : { monthly_cents: 0, lump_cents: p.pots_today_cents + Math.round(p.account_pension_today_cents * p.disbursement_months), start: p.start_age_months, short };
        projected.set(a, r);
      }
      hit = { monthly_cents: r.monthly_cents, lump_cents: r.lump_cents, unlock_age_months: Math.max(r.start, age), eligible: r.short === 0, short_months: r.short };
      cache.set(age, hit);
    }
    return hit;
  };
}
