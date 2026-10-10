// 退休估算的小工具（PLANNING_DESIGN §6）：养老金结果类型、进展与应急金线。主体计算在 plan-ledger.ts。
// 「未来缺口折现」代替 4% 法则：提前辞职的人先靠存款，到养老金起领年龄后才有养老金与公积金、
// 个人养老金的一次性解锁。输出是估算，内部用浮点，显示时取整到分。

/** 在某个辞职年龄（月）下的养老金与锁定资金，均为今天的钱（分）。 */
export type Pension = {
  monthly_cents: number; lump_cents: number; unlock_age_months: number;
  /** Separate monthly-income start. Undefined preserves existing behavior;
   * null explicitly means no payable pension. Pool unlocking is independent. */
  income_start_age_months?: number | null;
  /** 缴费年限不足最低要求时为 false，short_months 是还差的月数；不足时 monthly_cents 为 0。缺省视为满足。 */
  eligible?: boolean; short_months?: number;
};

export const pensionIncomeStart = (p: Pension): number => p.income_start_age_months === undefined ? p.unlock_age_months : p.income_start_age_months ?? Infinity;

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
