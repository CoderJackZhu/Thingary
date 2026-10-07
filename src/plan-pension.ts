// 中国养老金估算（PLANNING_DESIGN §5）：不碰数据库的纯函数。所有「今天」由调用方传入。
// 输出是估算：内部用浮点，金额在出口取整到分；不得写回或冒充已记录事实。
// 不处理 1996 年前视同缴费的过渡性养老金。
import { elapsedMonths } from './plan-core.ts';
import { PERSONAL_PENSION_CAP_CENTS, PERSONAL_PENSION_TAX_HUNDREDTHS, pensionMonths } from './plan-params.ts';
import type { Assumptions, RegionParams } from './plan-params.ts';

export type Worker = 'male' | 'female_cadre' | 'female_worker';

export type Profile = {
  /** 出生年月 YYYY-MM。 */
  birth_month: string;
  worker: Worker;
  /** 社保 App 当前显示的累计缴费月数与个人账户余额（分）。 */
  paid_months: number;
  account_balance_cents: string;
  /** 当前月缴费基数（分）。 */
  base_cents: string;
  /** 历史平均缴费指数 ×100（80 = 0.80）；null 表示与当前相同。 */
  past_index_hundredths: number | null;
  /** 弹性提前（负）或延后（正）领取，单位月，限 ±36。 */
  flex_months: number;
  /** 个人养老金每年缴存（分），0 表示未开户。 */
  personal_pension_annual_cents: string;
  /** 个人所得税边际税率，万分比；用于估算个人养老金每年省税。 */
  marginal_tax_hundredths: number;
  assumptions: Assumptions;
};

export type Funds = { hpf_balance_cents: string; hpf_monthly_cents: string; first_month_fraction?: number; personal_pension_balance_cents?: string; pp_quit_age_months?: number; pp_start_age_months?: number; hpf_growth_hundredths?: number };

/** 缴费分段：从该年龄（月）起，社保缴费基数与公积金月缴存（今天的钱，分）改成这两个数；按 from_age_months 升序。
 *  不给分段时全程用资料里的基数与公积金月缴存。 */
export type Employment = { from_age_months: number; base_cents: number; hpf_monthly_cents: number };

export type Projection = {
  /** 领取年龄（月）与领取月份 YYYY-MM。 */
  start_age_months: number;
  start_month: string;
  /** 假设在此年龄（月）停止缴费（不早于现在，不晚于领取年龄）。 */
  quit_age_months: number;
  contribution_months: number;
  total_paid_months: number;
  required_months: number;
  eligible: boolean;
  /** 领取时分摊的月数（计发月数，已按月插值）。 */
  disbursement_months: number;
  /** 以下月额均为分；nominal = 领取当月名义值，today = 折算成今天的钱。 */
  base_pension_nominal_cents: number;
  account_pension_nominal_cents: number;
  total_nominal_cents: number;
  base_pension_today_cents: number;
  account_pension_today_cents: number;
  total_today_cents: number;
  /** 养老金（今天的钱）÷ 停缴时月缴费基数（今天的钱），万分比；基数为 0 时 null。 */
  replacement_hundredths: number | null;
  account_at_start_cents: number;
  /** 到领取年龄的公积金与个人养老金（税后）余额，名义与今天的钱。 */
  hpf_at_start_cents: number;
  personal_pension_at_start_cents: number;
  personal_pension_after_tax_cents: number;
  pots_today_cents: number;
  /** 个人养老金每年节省的个税（分）。 */
  personal_pension_tax_saved_cents: number;
  years_to_start: number;
};

const ORIGINAL_AGE: Record<Worker, number> = { male: 60, female_cadre: 55, female_worker: 50 };
const TARGET_AGE: Record<Worker, number> = { male: 63, female_cadre: 58, female_worker: 55 };
const START_MONTH: Record<Worker, string> = { male: '1965-01', female_cadre: '1970-01', female_worker: '1975-01' };
const STEP: Record<Worker, number> = { male: 4, female_cadre: 4, female_worker: 2 };

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthText = (index: number) => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
const cents = (s: string) => Number(s);
const rate = (hundredths: number) => hundredths / 10000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 法定退休年龄的延迟月数（国务院办法；比起算出生月早的不延迟）。 */
export function delayMonths(worker: Worker, birthMonth: string): number {
  const m = monthIndex(birthMonth) - monthIndex(START_MONTH[worker]);
  if (m < 0) return 0;
  const cap = (TARGET_AGE[worker] - ORIGINAL_AGE[worker]) * 12;
  return Math.min(cap, Math.floor(m / STEP[worker]) + 1);
}

/** 法定退休年龄（月）。 */
export const statutoryAgeMonths = (worker: Worker, birthMonth: string) => ORIGINAL_AGE[worker] * 12 + delayMonths(worker, birthMonth);

/** 实际领取年龄（月）：法定年龄加弹性（限 ±36 个月），提前不得早于原法定退休年龄。 */
export function startAgeMonths(p: Pick<Profile, 'worker' | 'birth_month' | 'flex_months'>): number {
  const statutory = statutoryAgeMonths(p.worker, p.birth_month);
  return Math.max(ORIGINAL_AGE[p.worker] * 12, statutory + clamp(Math.trunc(p.flex_months), -36, 36));
}

/** 个人账户养老金计发月数：整岁取表值，非整岁按月线性插值（官方修订表出台前的近似）。 */
export function disbursementMonths(ageMonths: number): number {
  const years = clamp(ageMonths / 12, 40, 70);
  const lo = Math.min(69, Math.floor(years));
  return pensionMonths[lo] + (pensionMonths[lo + 1] - pensionMonths[lo]) * (years - lo);
}

/** 按月领取基本养老金的最低缴费月数：2030 年起每年加 6 个月，由 15 年到 20 年（2030 年为 15.5 年）。 */
export const requiredContributionMonths = (retireYear: number) => 180 + 6 * clamp(retireYear - 2029, 0, 10);

/** 现在的年龄（月），按年月计。 */
export const ageMonthsAt = (birthMonth: string, today: string) => monthIndex(today.slice(0, 7)) - monthIndex(birthMonth);

/** 在 quitAgeMonths 停止缴费时的养老金与锁定资金估算。 */
export function project(profile: Profile, region: RegionParams, today: string, quitAgeMonths: number, funds: Funds, employment: Employment[] = [], idle?: (ageMonths: number) => number): Projection {
  const a = profile.assumptions;
  const g = rate(a.wage_growth_hundredths), inflation = rate(a.inflation_hundredths);
  const notional = rate(region.notional_rate_hundredths), hpfRate = rate(region.hpf_rate_hundredths), ppRate = rate(a.pp_return_hundredths);
  const nowAge = ageMonthsAt(profile.birth_month, today);
  const start = startAgeMonths(profile);
  const toStart = Math.max(0, start - nowAge);
  const quit = clamp(Math.trunc(quitAgeMonths), nowAge, Math.max(nowAge, start));
  const contribution = Math.max(0, quit - nowAge);
  const retireIndex = monthIndex(profile.birth_month) + start;
  const retireYear = Math.floor(retireIndex / 12);

  const wage = cents(region.avg_wage_cents);
  const base = clamp(cents(profile.base_cents), cents(region.base_lower_cents), cents(region.base_upper_cents));
  const grow = (months: number) => (1 + g) ** (elapsedMonths(months, funds.first_month_fraction) / 12);
  const monthly = (annualRate: number) => (1 + annualRate) ** (1 / 12);

  // 个人账户：现有余额按记账利率增值，缴费期每月计入基数的 8%。
  let account = cents(profile.account_balance_cents);
  let hpf = cents(funds.hpf_balance_cents);
  let pp = Number(funds.personal_pension_balance_cents ?? '0');
  const ppMonthly = Math.min(cents(profile.personal_pension_annual_cents), PERSONAL_PENSION_CAP_CENTS) / 12;
  const hpfMonthly = cents(funds.hpf_monthly_cents);
  // 第 k 个缴费月适用的基数与公积金月缴存：最近一个已开始的分段，之前用资料里的。
  const phaseAt = (k: number) => { let e: Employment | null = null; for (const x of employment) if (x.from_age_months <= nowAge + k) e = x; return e; };
  const baseAt = (k: number) => { const e = phaseAt(k); return e ? clamp(e.base_cents, cents(region.base_lower_cents), cents(region.base_upper_cents)) : base; };
  // idle：某个月龄里没有缴费的比例（0–1，空窗期停缴）；缴费月数、个人账户、公积金与缴费指数都按实际缴费的份额计。
  let indexSum = 0, effective = 0;
  for (let k = 0; k < toStart; k++) {
    const fraction = k === 0 ? funds.first_month_fraction ?? 1 : 1;
    account *= monthly(notional) ** fraction;
    hpf *= monthly(hpfRate) ** fraction;
    pp *= monthly(ppRate) ** fraction;
    if (k < contribution) {
      const b = baseAt(k), e = phaseAt(k), w = (1 - clamp(idle ? idle(nowAge + k) : 0, 0, 1)) * fraction;
      account += 0.08 * b * grow(k) * w;
      hpf += (e ? e.hpf_monthly_cents : hpfMonthly) * (1 + rate(funds.hpf_growth_hundredths ?? a.wage_growth_hundredths)) ** (elapsedMonths(k, funds.first_month_fraction) / 12) * w;
      if (nowAge + k >= (funds.pp_start_age_months ?? nowAge) && nowAge + k < (funds.pp_quit_age_months ?? quit)) pp += ppMonthly * fraction;
      indexSum += clamp(b / wage, 0.6, 3) * w;
      effective += w;
    }
  }

  const totalMonths = Math.max(0, profile.paid_months) + Math.round(effective);
  const kNow = clamp(base / wage, 0.6, 3);
  const kPast = clamp(profile.past_index_hundredths === null ? kNow : profile.past_index_hundredths / 100, 0.6, 3);
  const kAvg = totalMonths === 0 ? 0 : (Math.max(0, profile.paid_months) * kPast + (employment.length ? indexSum : effective * kNow)) / totalMonths;
  const wageAtStart = wage * (1 + g) ** Math.max(0, retireYear - 1 - region.avg_wage_year);
  const basePension = ((wageAtStart + wageAtStart * kAvg) / 2) * (totalMonths / 12) * 0.01;
  const disbursement = disbursementMonths(start);
  const accountPension = account / disbursement;

  const deflate = (1 + inflation) ** (elapsedMonths(toStart, funds.first_month_fraction) / 12);
  const required = requiredContributionMonths(retireYear);
  const totalNominal = basePension + accountPension;
  const stopWageToday = (contribution > 0 ? baseAt(contribution - 1) : cents(profile.base_cents)) * ((1 + g) / (1 + inflation)) ** (elapsedMonths(contribution, funds.first_month_fraction) / 12);
  const ppAfterTax = pp * (1 - PERSONAL_PENSION_TAX_HUNDREDTHS / 10000);
  const round = Math.round;
  return {
    start_age_months: start, start_month: monthText(retireIndex), quit_age_months: quit,
    contribution_months: contribution, total_paid_months: totalMonths, required_months: required, eligible: totalMonths >= required,
    disbursement_months: disbursement,
    base_pension_nominal_cents: round(basePension), account_pension_nominal_cents: round(accountPension), total_nominal_cents: round(totalNominal),
    base_pension_today_cents: round(basePension / deflate), account_pension_today_cents: round(accountPension / deflate), total_today_cents: round(totalNominal / deflate),
    replacement_hundredths: stopWageToday > 0 ? round((totalNominal / deflate / stopWageToday) * 10000) : null,
    account_at_start_cents: round(account),
    hpf_at_start_cents: round(hpf), personal_pension_at_start_cents: round(pp), personal_pension_after_tax_cents: round(ppAfterTax),
    pots_today_cents: round((hpf + ppAfterTax) / deflate),
    personal_pension_tax_saved_cents: round(Math.min(cents(profile.personal_pension_annual_cents), PERSONAL_PENSION_CAP_CENTS) * rate(profile.marginal_tax_hundredths)),
    years_to_start: elapsedMonths(toStart, funds.first_month_fraction) / 12,
  };
}

/** 对一组停缴年龄（岁）各重算一次：辞职越早，缴费年限、个人账户与公积金越少（§5.4）。 */
export function byQuitAge(profile: Profile, region: RegionParams, today: string, agesYears: number[], funds: Funds, employment: Employment[] = []): Projection[] {
  return agesYears.map(y => project(profile, region, today, y * 12, funds, employment));
}
