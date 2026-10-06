// 退休与 FIRE 的输入汇总与计算（纯函数）：目标卡片、详情页与心愿详情共用，结果不存库。
import { fundsFrom } from './plan.ts';
import type { Income, PlanReview, ProfileState, RetireInputs, StoredLifeEvent } from './plan.ts';
import { beijing, effectiveParams } from './plan-params.ts';
import { emergency, pensionTable } from './plan-fire.ts';
import type { Keep } from './plan-fire.ts';
import { ageMonthsAt, startAgeMonths } from './plan-pension.ts';
import { applyEvents, offsetOf } from './plan-events.ts';
import type { LifeEvent } from './plan-events.ts';
import { expectedSaving, outcome, project } from './plan-ledger.ts';
import { routeById, routeEmployment, routeSavingPhases, routes } from './plan-routes.ts';
import { table } from './plan-ledger.ts';
import type { Flow, Plan, SavingPhase, SpendItem } from './plan-ledger.ts';
import type { Snapshot } from './wealth.ts';

export { expectedSaving };

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


/** 不再工作之后每月必须付的钱（今天的钱，分）：日常生活预算、房租，以及空窗期也续缴时的社保自缴。
 *  空窗期没有收入时就是靠这笔钱活着，所以折算空窗比例用它，不只是日常生活预算。 */
export const leaveCost = (r: RetireInputs, living: number) => living + Number(r.rent_cents) + (r.gap_keeps_paying ? Number(r.keep_paying_monthly_cents) : 0);

/** 缴费设置：续缴到几岁、按什么基数缴，以及某个月龄里没有缴费的比例。
 *  空窗（储蓄为负的阶段，或有收入阶段里的平均空窗比例，选了路线则是路线的比例）默认停缴；勾选「空窗期也续缴」则不停。 */
export function keepFor(r: RetireInputs, now: number): Keep {
  const keepUntil = r.keep_paying_until_age === null ? null : r.keep_paying_until_age * 12;
  const base = Number(r.keep_paying_base_cents);
  if (r.gap_keeps_paying) return { keepUntil, base };
  const route = routeById(r.route_id), routeFrom = r.route_from_age * 12, own = r.gap_share_hundredths / 10000;
  const phases = r.saving_phases;
  const idle = (m: number) => {
    if (route && m >= routeFrom) return route.gap_share_hundredths / 10000;
    if (!phases.length) return 0;
    let at = phases[0];
    for (let i = 1; i < phases.length; i++) if (phases[i].from_age_months <= m) at = phases[i];
    return at.monthly_cents < 0 ? 1 : own;
  };
  return { keepUntil, base, idle };
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
    const route = routeById(r.route_id), routeFrom = r.route_from_age * 12;
    const employment = route ? routeEmployment(route, routeFrom, monthlyHpfOut(review)) : [];
    const plan0 = retirePlan(saved, { now, horizon, assets, saving, spend, pension_at: pensionTable(p, region, today, funds, now, Math.max(now, start), employment, keepFor(r, now)) });
    // 大额计划：计入的并进同一个账本；plan0 是不含任何计划的版本，用来逐件比较影响。
    const events = r.life_events.map(toEvent);
    const plan = applyEvents(plan0, events.filter(e => e.included).map(e => ({ e, offset: offsetOf(e.date, today) })));
    const proj = project(plan, Number(today.slice(0, 4)));
    return {
      p, r, now, start, missing, assets, saving, measured, spend, derivedSpend, plan, plan0, events, proj, out: outcome(plan, proj),
      // 应急金按离职后的全部必需支出算（日常生活、房租、续缴社保等），不只是日常生活预算。
      emergency: emergency(assets, table(plan).essential[0] ?? spend, r.emergency_months),
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
    saving_phases: savingPhases(r, x.now, saving, leaveCost(r, spend)),
    pension_at: x.pension_at, spends: [],
    spend_flows: leaveFlows(r, x.now), rent_cents: Number(r.rent_cents),
  };
}

/** 离职之后的持续支出：房租（买房后由购房取代）与续缴社保（到续缴年龄为止）。都是必需支出；只在退休后的月份起作用。 */
function leaveFlows(r: RetireInputs, now: number): Flow[] {
  const flows: Flow[] = [], rent = Number(r.rent_cents), pay = Number(r.keep_paying_monthly_cents);
  if (rent > 0) flows.push({ label: '房租', from_month: now, to_month: null, cents: rent, nominal: false, essential: true });
  if (pay > 0 && r.keep_paying_until_age !== null) flows.push({ label: '续缴社保', from_month: now, to_month: r.keep_paying_until_age * 12, cents: pay, nominal: false, essential: true });
  return flows;
}

/** 最近一个可比区间里每月平均从公积金提取多少（分，推算；没有或为负时为 0）。 */
export function monthlyHpfOut(review: PlanReview): number {
  const iv = [...review.intervals].reverse().find(i => i.status === 'ok' && i.hpf_out_cents !== null);
  if (!iv || iv.days <= 0) return 0;
  return Math.max(0, Math.round(Number(iv.hpf_out_cents) * 487 / (16 * iv.days)));
}

/** 引擎用的储蓄阶段：用户的阶段（按平均空窗比例折算）或盘点中位数；选了路线则从换路线的年龄起由路线取代。 */
function savingPhases(r: RetireInputs, now: number, measured: number, living: number): SavingPhase[] | undefined {
  const user: SavingPhase[] = r.saving_phases.map((ph, i) => ({ from_month: i === 0 ? now : ph.from_age_months, cents: expectedSaving(ph.monthly_cents, r.gap_share_hundredths, living) }));
  const route = routeById(r.route_id);
  if (!route) return user.length ? user : undefined;
  return routeSavingPhases(user, measured, now, route, r.route_from_age * 12, living);
}

/** 各条路线（以及不选路线）并排：财务独立月龄与是否够用，用同一个构建函数，只换路线。 */
export type RouteResult = { id: string | null; label: string; fi_month: number | null; funded_at_goal: boolean; shortfall_month: number | null };
export function routeCompare(saved: NonNullable<ProfileState['saved']>, snapshot: Snapshot | null, review: PlanReview, incomes: Income[], today: string): RouteResult[] {
  const ids: (string | null)[] = [null, ...routes.map(x => x.id)];
  return ids.map(id => {
    const c = buildRetireCalc({ ...saved, profile: { ...saved.profile, retire: { ...saved.profile.retire, route_id: id } } }, snapshot, review, incomes, today);
    return { id, label: id === null ? '不选路线' : routeById(id)!.label, fi_month: c.out ? c.out.fi_month : null, funded_at_goal: !!c.out && c.out.funded_at_goal, shortfall_month: c.out ? c.out.shortfall_month : null };
  });
}

/** 存储形态（金额为整数分字符串）转成引擎用的数字。 */
export const toEvent = (e: StoredLifeEvent): LifeEvent => ({
  id: e.id, label: e.label, kind: e.kind, date: e.date, included: e.included,
  price_cents: Number(e.price_cents), down_cents: Number(e.down_cents), extra_cents: Number(e.extra_cents),
  loan_rate_hundredths: e.loan_rate_hundredths, loan_years: e.loan_years,
  holding_cents: Number(e.holding_cents), rent_saved_cents: Number(e.rent_saved_cents),
  cycle_years: e.cycle_years, until_age: e.until_age, resale_cents: Number(e.resale_cents),
});

