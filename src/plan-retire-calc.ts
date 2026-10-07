// 退休与 FIRE 的输入汇总与计算（纯函数）：目标卡片、详情页与心愿详情共用，结果不存库。
import { fundsFrom } from './plan.ts';
import { normalizeFunds, occurrenceMissing, costSources, includedReference } from './plan-core.ts';
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

/** 规划可用资金与负债本金分开；完整测算还需要显式确认各账户规则。 */
export function disposable(snapshot: Snapshot | null): number | null {
  return normalizeFunds(snapshot).available;
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
    // 未来公积金采用单独确认的假设，不沿用历史非零金额。
    const core = r.core, normalized = normalizeFunds(snapshot, core);
    const funds = { ...gross, hpf_monthly_cents: core?.hpf_monthly_cents ?? '0' };
    // Only confirmed, counted restricted housing-fund balances enter this pool.
    funds.hpf_balance_cents = String(normalized.housingFund);
    const anchor = snapshot?.date ?? today;
    const now = ageMonthsAt(p.birth_month, anchor), start = startAgeMonths(p);
    const basis = core?.monetary_basis_date ?? today;
    const basisFactor = (1 + p.assumptions.inflation_hundredths / 10000) ** ((Date.parse(anchor) - Date.parse(basis)) / (86400000 * 365.25));
    funds.hpf_monthly_cents = String(Math.round(Number(core?.hpf_monthly_cents ?? 0) * basisFactor));
    const assets = normalized.available === null ? null : normalized.available / basisFactor;
    const measured = stats.mean_monthly_change_cents == null ? null : Number(stats.mean_monthly_change_cents);
    // 显式净投入阶段保留；旧自动参考不作为未来假设。
    const saving = r.saving_phases.length ? r.saving_phases[0].monthly_cents : null;
    const derivedSpend = null; // Asset changes do not establish historical spending.
    const spend = r.spend_cents !== null ? Number(r.spend_cents) : null;
    const missing: string[] = [...normalized.missing, ...(saved.reference_issues ?? [])];
    if (snapshot) missing.push(...occurrenceMissing(snapshot, core, r.life_events, today));
    if ((Number(p.personal_pension_annual_cents) > 0 || !!core?.personal_pension_account_id) && !core?.personal_pension_balance_confirmed) missing.push('已有个人养老金余额待核对；无余额也需明确确认。');
    const ppEntry = snapshot?.entries.find(e => e.account_id === core?.personal_pension_account_id && e.side === 'asset' && e.counted);
    if (core?.personal_pension_account_id && (!ppEntry || ppEntry.kind === 'housing_fund' || !core.fund_rules.some(f => f.account_id === ppEntry.account_id && f.availability === 'restricted' && f.share_hundredths === 10000))) missing.push('个人养老金账户必须是单独确认的受限资产，不能同时进入可用／公积金池。');
    if ((Number(funds.hpf_balance_cents) > 0 || incomes.some(i => Number(i.fields.hpf_cents) > 0)) && core?.hpf_monthly_cents == null) missing.push('未来公积金缴存待确认（最新明确零优先）。');
    if (core && (snapshot?.entries ?? []).some(e => e.kind === 'housing_fund' && core.fund_rules.some(f => f.account_id === e.account_id && f.availability === 'available'))) missing.push('公积金解锁来源待核对，请保留受限规则。');
    const activeEvents = r.life_events.filter(e => e.included || core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred'));
    const sources = costSources(activeEvents, p.personal_pension_annual_cents);
    if (r.route_id && sources.length) missing.push('职业路线与费用包含关系尚未联合核对；请改用显式阶段。');
    for (const phase of r.saving_phases) for (const source of sources) {
      const occurred = source.id === 'personal_pension' || core?.occurrences.some(o => o.status === 'occurred' && source.id.startsWith(`event:${o.event_id}:`));
      if (!occurred && core?.costs.some(c => c.phase_id === phase.id && c.source_id === source.id && c.included)) missing.push(`${phase.label}：未发生费用不能标记已含；请改为额外费用。`);
      if (occurred && includedReference(core, phase, source.id) === null) missing.push(`${phase.label}：${source.label}包含关系待确认。`);
    }
    if (assets === null) missing.push('还没有完整盘点，算不出当前可支配资产。');
    if (saving === null) missing.push('未来净投入待确认：请在「储蓄阶段」保存明确假设；旧自动参考（含估值变化）不会采用。');
    if (spend === null) missing.push('请填写退休后月预算；历史支出仅作参考，不会自动成为退休预算。');
    if (r.horizon_age * 12 < now + 12) missing.push('规划终点年龄至少要比当前年龄晚一年，请在计划输入里调整。');
    if (missing.length || assets === null || saving === null || spend === null) return { p, r, now, start, missing, assets, saving, measured, spend, derivedSpend, emergency: undefined, plan: undefined, plan0: undefined, events: [] as LifeEvent[], proj: undefined, out: undefined };
    const horizon = r.horizon_age * 12;
    const route = routeById(r.route_id), routeFrom = r.route_from_age * 12;
    const employment = route ? routeEmployment(route, routeFrom, 0) : [];
    const fraction = snapshot?.date ? (new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7), 0)).getUTCDate() - +anchor.slice(8, 10)) / new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7), 0)).getUTCDate() : 1;
    const pensions = pensionTable(p, region, anchor, { ...funds, first_month_fraction: fraction, personal_pension_balance_cents: ppEntry?.amount_cents ?? '0', hpf_growth_hundredths: p.assumptions.inflation_hundredths }, now, Math.max(now, start), employment, keepFor(r, now));
    const anchored = { ...retirePlan(saved, { now, horizon, assets, saving, spend, pension_at: age => { const pen = pensions(age); return { ...pen, monthly_cents: pen.monthly_cents / basisFactor, lump_cents: pen.lump_cents / basisFactor }; } }), anchor_date: anchor, calculation_date: today, monetary_basis_date: basis, basis_factor: basisFactor, first_month_fraction: fraction, core };
    // 大额计划：计入的并进同一个账本；plan0 保留全部已发生安排，只排除未来设想，用来逐件比较影响。
    const events = r.life_events.map(toEvent);
    const occurred = (id: string) => core?.occurrences.some(o => o.event_id === id && o.status === 'occurred');
    const plan0 = applyEvents(anchored, events.filter(e => occurred(e.id)).map(e => ({ e, offset: offsetOf(e.date, anchor) })));
    const plan = applyEvents(plan0, events.filter(e => e.included && !occurred(e.id)).map(e => ({ e, offset: offsetOf(e.date, anchor) })));
    const proj = project(plan, Number(anchor.slice(0, 4)));
    return {
      p, r, now, start, missing, assets, saving, measured, spend, derivedSpend, plan, plan0, events, proj, out: outcome(plan, proj),
      // 应急金按离职后的全部必需支出算（日常生活、房租、续缴社保等），不只是日常生活预算。
      emergency: emergency(assets, table(plan).essential[0] ?? spend, r.emergency_months),
    };
}
export type RetireCalc = ReturnType<typeof buildRetireCalc>;

/** 引擎输入：日常生活预算是必需的第一个支出桶，其余支出项与收入项来自资料；养老金按辞职年龄重算。
 *  净投入采用独立阶段，阶段内保持 T 实际金额；工资增长仅用于养老金，名义金额按同一 B/T 系数换算。 */
export function retirePlan(saved: NonNullable<ProfileState['saved']>, x: { now: number; horizon: number; assets: number; saving: number; spend: number; pension_at: Plan['pension_at'] }): Plan {
  const p = saved.profile, r = p.retire, a = p.assumptions, { spend, assets, saving } = x;
  const normalizedStages = { ...r, saving_phases: r.saving_phases.map(phase => ({ ...phase, monthly_cents: phase.monthly_cents + (r.core?.costs ?? []).filter(c => c.phase_id === phase.id && c.included && (c.source_id === 'personal_pension' && Number(p.personal_pension_annual_cents) > 0 || r.life_events.some(e => r.core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred') && costSources([e], '0').some(s => s.id === c.source_id)))).reduce((s,c) => s + Number(c.reference_cents), 0) })) };
  const items: SpendItem[] = [
    { id: 'living', label: '日常生活', monthly_cents: spend, start_age: null, end_age: null, inflation_hundredths: null, essential: true },
    ...r.spend_items.map(i => ({ ...i, monthly_cents: Number(i.monthly_cents) })),
  ];
  return {
    now_months: x.now, horizon_months: x.horizon, search_cap_months: Math.min(SEARCH_CAP_YEARS * 12, x.horizon),
    target_months: Math.max(r.target_age * 12, x.now), mode: r.mode,
    assets_cents: assets, saving_cents: saving,
    saving_growth_hundredths: 0, // Net contribution growth must not inherit wage growth implicitly.
    r_before_hundredths: r.real_return_before_hundredths, r_after_hundredths: r.real_return_after_hundredths,
    inflation_hundredths: a.inflation_hundredths, volatility_hundredths: r.volatility_hundredths,
    items, incomes: r.income_items.map(i => ({ ...i, monthly_cents: Number(i.monthly_cents) })),
    saving_phases: savingPhases(normalizedStages, x.now, saving, leaveCost(r, spend)),
    saving_flows: Number(p.personal_pension_annual_cents) > 0 ? [{ label: '个人养老金现金转入', from_month: x.now, to_month: startAgeMonths(p), cents: -Number(p.personal_pension_annual_cents) / 12, nominal: true, essential: false, prorate_first: true }] : [],
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

/** 引擎用的储蓄阶段：用户确认的阶段（按平均空窗比例折算）；选了路线则从换路线的年龄起由路线取代。 */
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

