// 退休与 FIRE 的输入汇总与计算（纯函数）：目标卡片、详情页与心愿详情共用，结果不存库。
import { fundsFrom } from './plan.ts';
import type { Income, PlanReview, ProfileState, StoredLifeEvent } from './plan.ts';
import { beijing, effectiveParams } from './plan-params.ts';
import { emergency, pensionTable } from './plan-fire.ts';
import { ageMonthsAt, startAgeMonths } from './plan-pension.ts';
import { applyEvents, offsetOf } from './plan-events.ts';
import type { LifeEvent } from './plan-events.ts';
import { outcome, project } from './plan-ledger.ts';
import type { Plan, SpendItem } from './plan-ledger.ts';
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
    const { funds: gross } = fundsFrom(snapshot?.entries ?? null, incomes);
    // 公积金池每月净增加 = 最近非零缴存 − 近期每月平均提取（自动提取等），由复盘区间的缴存与余额变化推算。
    const funds = { ...gross, hpf_monthly_cents: String(Math.max(0, Number(gross.hpf_monthly_cents) - monthlyHpfOut(review))) };
    const now = ageMonthsAt(p.birth_month, today), start = startAgeMonths(p);
    const assets = disposable(snapshot);
    const measured = stats.median_monthly_saving_cents === null ? null : Number(stats.median_monthly_saving_cents);
    // 用户填了储蓄阶段就以阶段为准（盘点中位数含一次性大额消费与失业月份，只作参考）；没填才用盘点中位数。
    const saving = r.saving_phases.length ? r.saving_phases[0].monthly_cents : measured;
    const derivedSpend = stats.median_monthly_spend_cents === null ? null : Number(stats.median_monthly_spend_cents);
    const spend = r.spend_cents !== null ? Number(r.spend_cents) : null;
    const missing: string[] = [];
    if (assets === null) missing.push('还没有完整盘点，算不出当前可支配资产。');
    if (saving === null) missing.push('还没有常态月储蓄：需要至少两次完整盘点并记录月度收入，或者在「储蓄阶段」里直接填写每月储蓄。');
    if (spend === null) missing.push('请填写退休后月预算；历史支出仅作参考，不会自动成为退休预算。');
    if (r.horizon_age * 12 < now + 12) missing.push('规划终点年龄至少要比当前年龄晚一年，请在计划输入里调整。');
    if (missing.length || assets === null || saving === null || spend === null) return { p, r, now, start, missing, assets, saving, measured, spend, derivedSpend, emergency: undefined, plan: undefined, plan0: undefined, events: [] as LifeEvent[], proj: undefined, out: undefined };
    const horizon = r.horizon_age * 12;
    const plan0 = retirePlan(saved, { now, horizon, assets, saving, spend, pension_at: pensionTable(p, region, today, funds, now, Math.max(now, start)) });
    // 大额计划：计入的并进同一个账本；plan0 是不含任何计划的版本，用来逐件比较影响。
    const events = r.life_events.map(toEvent);
    const plan = applyEvents(plan0, events.filter(e => e.included).map(e => ({ e, offset: offsetOf(e.date, today) })));
    const proj = project(plan, Number(today.slice(0, 4)));
    return {
      p, r, now, start, missing, assets, saving, measured, spend, derivedSpend, plan, plan0, events, proj, out: outcome(plan, proj),
      emergency: emergency(assets, spend, r.emergency_months),
    };
}
export type RetireCalc = ReturnType<typeof buildRetireCalc>;

/** 引擎输入：日常生活预算是必需的第一个支出桶，其余支出项与收入项来自资料；养老金按辞职年龄重算。
 *  储蓄的实际增长＝工资增长相对通胀；名义换算只在展示时用通胀。 */
export function retirePlan(saved: NonNullable<ProfileState['saved']>, x: { now: number; horizon: number; assets: number; saving: number; spend: number; pension_at: Plan['pension_at'] }): Plan {
  const p = saved.profile, r = p.retire, a = p.assumptions, { spend, assets, saving } = x;
  const items: SpendItem[] = [
    { id: 'living', label: '日常生活', monthly_cents: spend, start_age: null, end_age: null, inflation_hundredths: null, essential: true },
    ...r.spend_items.map(i => ({ ...i, monthly_cents: Number(i.monthly_cents) })),
  ];
  return {
    now_months: x.now, horizon_months: x.horizon, search_cap_months: Math.min(SEARCH_CAP_YEARS * 12, x.horizon),
    target_months: Math.max(r.target_age * 12, x.now), mode: r.mode,
    assets_cents: assets, saving_cents: saving,
    saving_growth_hundredths: Math.round(((1 + a.wage_growth_hundredths / 10000) / (1 + a.inflation_hundredths / 10000) - 1) * 10000),
    r_before_hundredths: r.real_return_before_hundredths, r_after_hundredths: r.real_return_after_hundredths,
    inflation_hundredths: a.inflation_hundredths, volatility_hundredths: r.volatility_hundredths,
    items, incomes: r.income_items.map(i => ({ ...i, monthly_cents: Number(i.monthly_cents) })),
    saving_phases: r.saving_phases.length ? r.saving_phases.map((ph, i) => ({ from_month: i === 0 ? x.now : ph.from_age_months, cents: expectedSaving(ph.monthly_cents, r.gap_share_hundredths, spend) })) : undefined,
    pension_at: x.pension_at, spends: [],
  };
}

/** 按平均空窗比例折算有收入阶段的储蓄：(1−g)·储蓄 − g·空窗时的月支出；已经为负的阶段（本身就是空窗）不动。 */
export const expectedSaving = (cents: number, gapHundredths: number, livingCents: number) => {
  if (cents <= 0 || gapHundredths <= 0) return cents;
  const g = gapHundredths / 10000;
  return Math.round((1 - g) * cents - g * livingCents);
};

/** 存储形态（金额为整数分字符串）转成引擎用的数字。 */
export const toEvent = (e: StoredLifeEvent): LifeEvent => ({
  id: e.id, label: e.label, kind: e.kind, date: e.date, included: e.included,
  price_cents: Number(e.price_cents), down_cents: Number(e.down_cents), extra_cents: Number(e.extra_cents),
  loan_rate_hundredths: e.loan_rate_hundredths, loan_years: e.loan_years,
  holding_cents: Number(e.holding_cents), rent_saved_cents: Number(e.rent_saved_cents),
  cycle_years: e.cycle_years, until_age: e.until_age, resale_cents: Number(e.resale_cents),
});

/** 最近一个可比区间里每月平均从公积金提取多少（分，推算；没有或为负时为 0）。 */
export function monthlyHpfOut(review: PlanReview): number {
  const iv = [...review.intervals].reverse().find(i => i.status === 'ok' && i.hpf_out_cents !== null);
  if (!iv || iv.days <= 0) return 0;
  return Math.max(0, Math.round(Number(iv.hpf_out_cents) * 487 / (16 * iv.days)));
}
