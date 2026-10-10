// Basic requirements and confirmed predictions share the existing full month ledger.
import { hasPensionProfile } from './plan.ts';
import type { StoredLifeEvent } from './plan.ts';
import type { BasicCapabilities, PlanningSources, PlanningMissing, Capability, RequirementResult, RequirementValue, PredictionValue, PlanningContext, CostScope, CapabilityName, PlanningAnnotation } from './plan-basic-contract.ts';
import { normalizeFunds, costSources, mustStayInLedger } from './plan-core.ts';
import { ageMonthsAt, project as pensionProject } from './plan-pension.ts';
import { paramsFor } from './plan-params.ts';
import { pensionPath, pensionPeriodIssue } from './plan-pension-path.ts';
import type { ContributionPeriod } from './plan-pension-path.ts';
import { applyEvents, monthIndex, offsetOf } from './plan-events.ts';
import type { LifeEvent } from './plan-events.ts';
import { project, outcome, required, startPaymentsOf, oneOffsOf } from './plan-ledger.ts';
import type { Plan, Flow, SpendItem } from './plan-ledger.ts';
import { basicConstraintMessages } from './plan-basic-validation.ts';
import { eventCoverage } from './plan-coverage.ts';
import { uniqueAnnotations } from './plan-annotations.ts';
import { debtReview, debtMonthIndex } from './plan-debt.ts';
import type { Pension } from './plan-fire.ts';

export const BASIC_SEARCH_LIMIT_CENTS = 100_000_000;
const ym = (i: number) => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
const missing = (code: PlanningMissing['code'], capability: CapabilityName, owner: PlanningMissing['owner'], field: string, message: string, kind: PlanningMissing['kind'] = 'assumption'): PlanningMissing => ({ code, capability, owner, field, message, kind });
const blocked = <T>(items: PlanningMissing[]): Capability<T> => ({ status: 'blocked', missing: items });
const eventValue = (e: StoredLifeEvent): LifeEvent => ({ ...e, price_cents: Number(e.price_cents), down_cents: Number(e.down_cents), extra_cents: Number(e.extra_cents), holding_cents: Number(e.holding_cents), rent_saved_cents: Number(e.rent_saved_cents), resale_cents: Number(e.resale_cents) });
const validSigned = (s: string) => /^-?(0|[1-9]\d*)$/.test(s) && Number.isSafeInteger(Number(s)) && Math.abs(Number(s)) <= BASIC_SEARCH_LIMIT_CENTS && String(Number(s)) === s;

/** Candidates are computation variables, never profile patches or prediction outputs. Dates/pension/fees are fixed. */
export function solveBasicRequirement(compile: (cents: number, before: number, after: number) => Plan, before: number, after: number): RequirementResult {
  const rates = { before_hundredths: before, after_hundredths: after };
  if (before < -1000 || before > 2000 || after < -1000 || after > 2000) return { ...rates, status: 'out_of_bounds', message: '两段实际收益调整 200 bps 后超出合法范围，本条件未应用。' };
  const zero = compile(0, before, after);
  const run = (n: number) => {
    const p = n === 0 ? zero : compile(n, before, after);
    // Fixed target. A FIRE trigger must never move the candidate retirement month.
    const fixed = { ...p, mode: 'traditional' as const };
    const proj = project(fixed, Number(p.anchor_date?.slice(0, 4) ?? 2000));
    const out = outcome(fixed, proj);
    return out.success && out.funded_at_goal;
  };
  const due = startPaymentsOf(zero, zero.target_months <= zero.now_months ? 'retired' : 'accumulation')[0] ?? 0, upfront = oneOffsOf(zero)[0] ?? 0;
  if (zero.assets_cents - upfront < due) return { ...rates, status: 'payment_constraint', message: '起点已有资金不足以支付首月付款；月底投入不能补月初支付，请补现有资金或调整付款时间。' };
  if (run(0)) return { ...rates, status: 'no_positive_contribution', monthly_cents: '0' };
  if (zero.target_months <= zero.now_months) return { ...rates, status: 'not_applicable', message: `没有目标前积累区间；当前退休所需 ${Math.ceil(required(zero, zero.now_months))} 分，需核对现有资金。` };
  if (!run(BASIC_SEARCH_LIMIT_CENTS)) return { ...rates, status: 'search_not_found', search_limit_cents: String(BASIC_SEARCH_LIMIT_CENTS) };
  // With fixed flows, retirement, contributions and positive monthly growth, every
  // extra cent only increases pre-target assets. Each rounded boundary is verified.
  let lo = 0, hi = BASIC_SEARCH_LIMIT_CENTS;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (run(mid)) hi = mid; else lo = mid; }
  if (!run(hi)) return { ...rates, status: 'search_not_found', search_limit_cents: String(BASIC_SEARCH_LIMIT_CENTS) };
  return { ...rates, status: 'found', monthly_cents: String(hi) };
}

export type BasicPlanCompiler = {
  included_reference_cents: number;
  compile: (amount: number, before: number, after: number, future?: boolean) => Plan;
  contribution: string | null;
  target_month: string;
  horizon_month: string;
  before: number;
  after: number;
};
export type BasicPlanPreparation = Pick<BasicCapabilities, 'context' | 'funds' | 'pension'> & {
  plan: Capability<BasicPlanCompiler>;
  predictionMissing: PlanningMissing[];
  annotations: PlanningAnnotation[];
};

/** Shared read-only normalization, with no wealth/history fallback or pension defaults.
 * Compiling a candidate never adopts it as a prediction; accumulation scope cannot certify retirement. */
export function prepareBasicPlan(sources: PlanningSources, temporaryContribution?: string, contributionPeriods: readonly ContributionPeriod[] = [], scope: 'complete' | 'accumulation' = 'complete', options: { includePools?: boolean } = {}): BasicPlanPreparation {
  const state = sources.profile.status === 'ready' ? sources.profile.value : null;
  const saved = state?.saved ?? null, p = saved?.profile, r = p?.retire, b = r?.basic;
  const snap = sources.modules.wealth && sources.snapshot.status === 'ready' ? sources.snapshot.value : null;
  const start: PlanningContext['start'] = b?.start.kind === 'simulation' ? { kind: 'simulation', id: b.start.id, date: b.start.date } : { kind: 'live', snapshot_id: snap?.id ?? null, revision: snap?.revision ?? null, date: snap?.date ?? null };
  const context: PlanningContext = { generation: sources.generation, revision: saved?.revision ?? null, today: sources.today, model_version: 'basic-2', modules: { ...sources.modules }, start, monetary_basis_date: r?.core?.monetary_basis_date ?? null, source: temporaryContribution === undefined ? 'saved' : 'temporary', write_version: sources.write_version };
  const annotations: PlanningAnnotation[] = [];
  const baseMissing: PlanningMissing[] = [];
  if (!sources.modules.planning) baseMissing.push(missing('SOURCE_ERROR', 'requirement', 'service', 'modules.planning', '规划模块已关闭。', 'read_error'));
  if (sources.profile.status === 'error') baseMissing.push(missing('SOURCE_ERROR', 'requirement', 'service', 'profile', sources.profile.value.message, 'read_error'));
  else if (!p || !b) baseMissing.push(missing('PROFILE_UNKNOWN', 'requirement', 'basic', 'retire.basic', '尚无通用基础输入；原规划不会自动转换。'));
  if (state && state.generation !== sources.generation) baseMissing.push(missing('SOURCE_STALE', 'requirement', 'service', 'generation', '来源身份已变化，请重新读取。', 'read_error'));
  for (const message of basicConstraintMessages(sources)) baseMissing.push(missing('INPUT_INVALID', 'requirement', 'basic', 'inputs', message, 'constraint'));
  if (!p || !r || !b || baseMissing.length) return { context, annotations, funds: blocked(baseMissing.map(x => ({ ...x, capability: 'funds' }))), plan: blocked(baseMissing), predictionMissing: baseMissing.map(x => ({ ...x, capability: 'prediction' })), pension: blocked(baseMissing.map(x => ({ ...x, capability: 'pension' }))) };
  const fundMissing: PlanningMissing[] = [];
  let available: number | null = null, restricted = 0, debt = 0, housing = 0;
  let anchor: string | null = null;
  if (b.start.kind === 'simulation') {
    available = b.start.available_cents === null ? null : Number(b.start.available_cents); anchor = b.start.date;
    if (available === null || anchor === null) fundMissing.push(missing('START_UNKNOWN', 'funds', 'basic', 'basic.start', '请明确模拟起点金额与截至日。'));
  } else if (!sources.modules.wealth) fundMissing.push(missing('WEALTH_DISABLED', 'funds', 'basic', 'basic.start', '财富模块已关闭；可明确替换为模拟起点，不读取隐藏财富。', 'read_error'));
  else if (sources.snapshot.status === 'error') fundMissing.push(missing('SOURCE_ERROR', 'funds', 'service', 'snapshot', sources.snapshot.value.message, 'read_error'));
  else {
    const f = normalizeFunds(snap, r.core); available = f.available; restricted = f.restricted; debt = f.debt; housing = f.housingFund; anchor = snap?.date ?? null;
    for (const message of f.missing) fundMissing.push(missing(snap ? 'FUNDS_UNCONFIRMED' : 'START_UNKNOWN', 'funds', 'funds', 'core.fund_rules', message));
  }
  const funds: BasicCapabilities['funds'] = fundMissing.length || available === null || anchor === null ? blocked(fundMissing) : { status: 'ready', value: { available_cents: String(Math.round(available)), restricted_cents: String(Math.round(restricted)), debt_cents: String(Math.round(debt)), date: anchor, kind: b.start.kind } };
  const reqMissing: PlanningMissing[] = fundMissing.map(x => ({ ...x, capability: 'requirement' }));
  if (p.birth_month === null) reqMissing.push(missing('BIRTH_UNKNOWN', 'requirement', 'basic', 'birth_month', '出生年月未知，不能确定目标月份。'));
  if (scope === 'complete' && r.target_age === null) reqMissing.push(missing('TARGET_UNKNOWN', 'requirement', 'basic', 'target_age', '目标退休年龄尚未选择。'));
  if (scope === 'complete' && r.spend_cents === null) reqMissing.push(missing('BUDGET_UNKNOWN', 'requirement', 'basic', 'spend_cents', '请明确完整退休总预算。'));
  const core = r.core;
  if (!core) reqMissing.push(missing('FUNDS_UNCONFIRMED', 'requirement', 'funds', 'core.monetary_basis_date', '金额基准尚未确认。'));
  const active = r.life_events.filter(e => !core?.occurrences.some(o => o.event_id === e.id && o.status === 'cancelled') && (e.included || core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred')));
  const debtSnapshot = b.start.kind === 'live' && sources.modules.wealth ? snap : null;
  const targetMonth = p.birth_month && r.target_age !== null ? ym(monthIndex(p.birth_month) + r.target_age * 12) : undefined;
  const horizonMonth = p.birth_month ? ym(monthIndex(p.birth_month) + r.horizon_age * 12) : undefined;
  const debtRows = debtReview(debtSnapshot, core, active, targetMonth, horizonMonth, sources.accounts.status === 'ready' ? sources.accounts.value : []).rows;
  const eventReview = eventCoverage(active, core, debtSnapshot, sources.today, saved?.reference_issues ?? [], { targetMonth, horizonMonth, accounts: sources.accounts.status === 'ready' ? sources.accounts.value : [] });
  annotations.push(...eventReview.annotations);
  const seenLoans = new Set<string>();
  for (const o of core?.occurrences ?? []) {
    if (o.actual_date > sources.today) reqMissing.push(missing('INPUT_INVALID', 'requirement', 'events', 'core.occurrences', '实际日期不能晚于今天。', 'constraint'));
    if (o.loan) {
      if (seenLoans.has(o.loan.account_id)) reqMissing.push(missing('INPUT_INVALID', 'requirement', 'events', 'core.occurrences', '同一余债不能重复接续。', 'constraint'));
      seenLoans.add(o.loan.account_id);
    }
  }
  if (b.start.kind === 'live' && snap?.entries.some(e => e.counted && e.kind === 'housing_fund' && core?.fund_rules.some(rule => rule.account_id === e.account_id && rule.availability === 'available'))) reqMissing.push(missing('POOL_UNCONFIRMED', 'requirement', 'funds', 'core.fund_rules', '公积金不能进入起点可用资金，须按受限池解锁。', 'fact'));
  const mode = b.retirement_income.mode;
  const penMissing: PlanningMissing[] = [];
  let pen: Pension = { monthly_cents: 0, lump_cents: 0, unlock_age_months: r.horizon_age * 12 };
  let pensionStart: string | null = null;
  if (scope === 'complete' && mode === null) reqMissing.push(missing('INCOME_MODE_UNKNOWN', 'requirement', 'basic', 'basic.retirement_income.mode', '请选择本次退休收入计入方式。'));
  const selected = b.retirement_income.selected;
  const seen = new Set<string>();
  for (const s of scope === 'complete' ? selected : []) {
    if (!r.income_items.some(i => i.id === s.id) || seen.has(s.source_id) || (mode === 'employee' && (s.role === 'state_pension' || s.source_id === 'state_pension_estimate'))) reqMissing.push(missing('INCOME_SOURCE_UNKNOWN', 'requirement', 'budget', 'basic.retirement_income.selected', '收入来源须核对；职工养老金不能与手填替代项双计。'));
    seen.add(s.source_id);
  }
  // Existing facts are not a request to include a pool. Only the chosen estimator uses policy unlock.
  const needsPools = (scope === 'complete' && mode === 'employee') || options.includePools === true;
  const region = paramsFor(p, sources.today);
  const periodIssue = region ? pensionPeriodIssue(contributionPeriods, region) : null;
  if (periodIssue) penMissing.push(missing('PENSION_CONTRIBUTIONS_UNKNOWN', 'pension', 'basic', 'contribution_periods', periodIssue, 'constraint'));
  const needsEstimator = needsPools || contributionPeriods.some(x => Number(x.hpf_monthly_cents) > 0);
  if (needsEstimator) {
    if (!region) penMissing.push(missing('PENSION_FACTS_UNKNOWN', 'pension', 'pension', p.region === 'custom' ? 'overrides.avg_wage_cents' : 'region', p.region === null ? '请选择参保地；也可以改选“先不算”先看结果。' : '请填写当地养老金计发基数；也可以改选“先不算”先看结果。', 'fact'));
    if (!hasPensionProfile(p)) penMissing.push(missing('PENSION_FACTS_UNKNOWN', 'pension', 'pension', 'profile', '你选择了职工养老金估算，还差社保资料；也可以改选“先不算”先看结果。', 'fact'));
    const ppEntry = b.start.kind === 'live' ? snap?.entries.find(e => e.account_id === core?.personal_pension_account_id && e.counted && e.side === 'asset') : null;
    if (b.start.kind === 'live' && core?.personal_pension_account_id && (!ppEntry || ppEntry.amount_cents === null || ppEntry.kind === 'housing_fund' || !core.fund_rules.some(rule => rule.account_id === ppEntry.account_id && rule.availability === 'restricted' && rule.share_hundredths === 10000))) penMissing.push(missing('POOL_UNCONFIRMED', 'pension', 'funds', 'core.personal_pension_account_id', '个人养老金须是独立确认的完整受限池，不能同时进入可用或公积金池。', 'fact'));
    const pc = b.pension_contributions;
    if (pc.start_month === null || pc.stop_month === null || pc.base_cents === null || core?.hpf_monthly_cents == null) penMissing.push(missing('PENSION_CONTRIBUTIONS_UNKNOWN', 'pension', 'basic', 'basic.pension_contributions', '请独立确认未来缴费起止月份、基数及公积金月缴存；不按投入符号停缴。'));
    if (pc.base_cents === '0' && pc.start_month !== null && pc.stop_month !== null && pc.start_month < pc.stop_month) penMissing.push(missing('PENSION_CONTRIBUTIONS_UNKNOWN', 'pension', 'basic', 'basic.pension_contributions.base_cents', '已确认缴费区间需要合法正基数；无未来缴费请明确相同起止月份。', 'constraint'));
    if ((!!core?.personal_pension_account_id || Number(p.personal_pension_annual_cents ?? 0) > 0) && !core?.personal_pension_balance_confirmed) penMissing.push(missing('POOL_UNCONFIRMED', 'pension', 'funds', 'core.personal_pension_balance_confirmed', '已有个人养老金余额待核对。', 'fact'));
    if (b.start.kind === 'simulation' && (housing > 0 || core?.personal_pension_account_id)) penMissing.push(missing('POOL_UNCONFIRMED', 'pension', 'funds', 'core.personal_pension_account_id', '模拟起点未确认隐藏受限池，不能复用其账户余额。', 'fact'));
    if (!penMissing.length && region && hasPensionProfile(p) && anchor && pc.start_month !== null && pc.stop_month !== null && pc.base_cents !== null) {
      const now = ageMonthsAt(p.birth_month, anchor), stop = monthIndex(pc.stop_month) - monthIndex(p.birth_month), from = monthIndex(pc.start_month) - monthIndex(p.birth_month);
      const days = new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7), 0)).getUTCDate(), fraction = (days - +anchor.slice(8, 10)) / days;
      const pp = b.start.kind === 'live' ? snap?.entries.find(e => e.account_id === core?.personal_pension_account_id && e.counted && e.side === 'asset') : null;
      const factor = (1 + p.assumptions.inflation_hundredths / 10000) ** ((Date.parse(anchor) - Date.parse(core?.monetary_basis_date ?? anchor)) / (86400000 * 365.25));
      const path = pensionPath(contributionPeriods, p.birth_month, now, from, stop, Number(pc.base_cents), Number(core?.hpf_monthly_cents), factor);
      const estimate = pensionProject(p, region, anchor, stop, { hpf_balance_cents: String(housing), hpf_monthly_cents: String(Math.round(Number(core?.hpf_monthly_cents) * factor)), personal_pension_balance_cents: pp?.amount_cents ?? '0', first_month_fraction: fraction, pp_quit_age_months: stop, pp_start_age_months: from, hpf_growth_hundredths: p.assumptions.inflation_hundredths }, path.employment, path.idle);
      pen = { monthly_cents: mode === 'employee' && estimate.eligible ? estimate.total_today_cents / factor : 0, lump_cents: estimate.pots_today_cents / factor, unlock_age_months: estimate.start_age_months, eligible: estimate.eligible, short_months: Math.max(0, estimate.required_months - estimate.total_paid_months) };
      pensionStart = estimate.start_month;
    }
  }
  if (mode === 'employee') for (const item of penMissing) if (!item.message.includes('改选')) item.message += '；也可以改选“先不算”先看结果。';
  reqMissing.push(...penMissing.map(x => ({ ...x, capability: 'requirement' as const })));
  const pension: BasicCapabilities['pension'] = mode === null ? blocked([missing('INCOME_MODE_UNKNOWN', 'pension', 'basic', 'basic.retirement_income.mode', '尚未选择退休收入怎么计入。')]) : penMissing.length ? blocked(penMissing) : { status: 'ready', value: { included: mode === 'employee', start_month: pensionStart, monthly_cents: mode === 'employee' ? String(Math.round(pen.monthly_cents)) : null } };
  const pc = b.pension_contributions, annual = Number(p.personal_pension_annual_cents ?? 0);
  const transferReady = annual > 0 && pc.start_month !== null && pc.stop_month !== null;
  if (annual > 0 && (pc.start_month !== null || pc.stop_month !== null) && !transferReady) annotations.push({ id: 'personal_pension:period', reason_code: 'TRANSFER_PENDING', message: '个人养老金未来转入排期未完整确认，该现金转入未计入。', effect: 'requirement_lower', treatment: 'omitted', source_ids: ['personal_pension'], missing_fields: ['转入起止月份'], refinement: { owner: 'budget', field: 'basic.pension_contributions' } });
  if (!needsEstimator && (housing > 0 || core?.personal_pension_account_id || annual > 0 || Number(core?.hpf_monthly_cents ?? 0) > 0)) annotations.push({ id: 'pools', reason_code: 'POOL_NOT_USED', message: '本次未引用个人养老金/公积金池，不预计解锁或领取；已明确的现金转入仍按排期计入。', effect: housing > 0 || core?.personal_pension_account_id || transferReady ? 'requirement_higher' : 'none', treatment: 'not_used', source_ids: ['pools'], missing_fields: [], refinement: { owner: 'pension', field: 'basic.retirement_income.mode' } });
  const sourceRows = costSources(active, transferReady ? p.personal_pension_annual_cents ?? '0' : '0').filter(s => {
    const event = active.find(e => s.id === `event:${e.id}:loan` || s.id === `event:${e.id}:holding`);
    if (!event) return true;
    const review = eventReview.coverage[event.id];
    return !review.paused && (s.id.endsWith(':loan') ? review.loan : review.holding);
  });
  const sourcesPre = [...new Set([...sourceRows.map(s => s.id), ...(core?.occurrences ?? []).filter(o => o.status === 'occurred' && eventReview.coverage[o.event_id]?.loan && o.loan && Number(o.loan.principal_cents) > 0).map(o => `event:${o.event_id}:loan`)])];
  const sourcesPost = [...sourcesPre, ...r.spend_items.map(s => `spend:${s.id}`), ...(Number(r.rent_cents) > 0 ? ['rent'] : []), ...(Number(r.keep_paying_monthly_cents) > 0 && r.keep_paying_until_age !== null ? ['social_insurance'] : [])];
  const knownPre = [...new Set([...sourcesPre, ...costSources(r.life_events, p.personal_pension_annual_cents ?? '0').map(s => s.id)])];
  const knownPost = [...knownPre, ...r.spend_items.map(s => `spend:${s.id}`), ...(Number(r.rent_cents) > 0 ? ['rent'] : []), ...(Number(r.keep_paying_monthly_cents) > 0 ? ['social_insurance'] : [])];
  const checkScope = (ids: string[], scopes: CostScope[], field: string, pre: boolean) => {
    const set = new Set<string>();
    for (const s of scopes) {
      if (!(pre ? knownPre : knownPost).includes(s.source_id) || set.has(s.source_id)) reqMissing.push(missing('COST_SCOPE_INVALID', 'requirement', 'budget', field, '费用来源失效或重复，请核对稳定来源。'));
      set.add(s.source_id);
      if (!ids.includes(s.source_id)) continue; // Disabled plans retain confirmations without affecting this calculation.
      const occurred = core?.occurrences.some(o => o.status === 'occurred' && s.source_id.startsWith(`event:${o.event_id}:`));
      if (s.treatment === 'included' && (s.reference_cents === null || (pre && s.source_id.startsWith('event:') && !occurred))) reqMissing.push(missing('COST_SCOPE_INVALID', 'requirement', 'budget', field, '已含参考额未知，或尚未发生费用被标作净投入已含。'));
      if (s.treatment === 'excluded' && mustStayInLedger(s.source_id)) reqMissing.push(missing('COST_SCOPE_INVALID', 'requirement', 'events', field, '月供和个人养老金转入是真实支出，必须计入：请把它改选为「已包含」或「另外加上」。', 'constraint'));
    }
    for (const id of ids) if (!scopes.some(s => s.source_id === id)) annotations.push({ id: `cost:${field}:${id}`, reason_code: 'COST_ASSUMED_EXTRA', message: `${sourceRows.find(s => s.id === id)?.label ?? r.spend_items.find(s => `spend:${s.id}` === id)?.label ?? (id === 'rent' ? '房租' : '续缴社保')}的${pre ? '净投入' : '退休总预算'}包含关系待核对：暂按额外费用计入，可能重复包含。`, effect: 'requirement_higher', treatment: 'assumed_extra', source_ids: [id], missing_fields: ['费用包含关系'], refinement: { owner: 'budget', field } });
  };
  checkScope(sourcesPre, b.contribution_costs, 'basic.contribution_costs', true);
  if (scope === 'complete') checkScope(sourcesPost, b.retirement_costs, 'basic.retirement_costs', false);
  const refs = (scope === 'complete' ? b.retirement_costs : []).filter(s => sourcesPost.includes(s.source_id) && s.treatment === 'included').reduce((sum, s) => sum + Number(s.reference_cents), 0);
  if (scope === 'complete' && r.spend_cents !== null && refs > Number(r.spend_cents)) reqMissing.push(missing('COST_SCOPE_INVALID', 'requirement', 'budget', 'basic.retirement_costs', '退休已含参考额不能超过总预算。'));
  if (anchor && p.birth_month !== null && r.horizon_age * 12 <= ageMonthsAt(p.birth_month, anchor)) reqMissing.push(missing('HORIZON_INVALID', 'requirement', 'basic', 'horizon_age', '规划终点须晚于资金起点。', 'constraint'));
  const contribution = temporaryContribution === undefined ? b.contribution.monthly_cents : temporaryContribution;
  const predictionMissing: PlanningMissing[] = reqMissing.map(x => ({ ...x, capability: 'prediction' }));
  if (contribution === null) predictionMissing.push(missing('CONTRIBUTION_UNKNOWN', 'prediction', 'basic', 'basic.contribution.monthly_cents', '保存预计投入后可查看预测及心愿影响；反求值不会作为预计投入。'));
  else if (!validSigned(contribution)) predictionMissing.push(missing('CONTRIBUTION_UNKNOWN', 'prediction', 'basic', 'basic.contribution.monthly_cents', '预计投入须是合法整数分，可明确为零或负数。', 'constraint'));
  if (reqMissing.length || funds.status !== 'ready' || p.birth_month === null || (scope === 'complete' && (r.target_age === null || r.spend_cents === null)) || !anchor || !core || available === null) return { context, annotations, funds, plan: blocked(reqMissing), predictionMissing, pension };
  const birth = p.birth_month, target = Math.max((r.target_age ?? r.horizon_age) * 12, ageMonthsAt(birth, anchor)), now = ageMonthsAt(birth, anchor), horizon = r.horizon_age * 12;
  const basisFactor = (1 + p.assumptions.inflation_hundredths / 10000) ** ((Date.parse(anchor) - Date.parse(core.monetary_basis_date)) / (86400000 * 365.25));
  const days = new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7), 0)).getUTCDate(), fraction = (days - +anchor.slice(8, 10)) / days;
  // Accumulation-only preparation does not certify any retirement income/budget.
  const budget = scope === 'complete' ? Number(r.spend_cents) : 0;
  const allowed = (id: string, scopes: CostScope[]) => scopes.find(s => s.source_id === id)?.treatment !== 'excluded';
  const items: SpendItem[] = [{ id: 'living', label: '总预算其他部分', monthly_cents: budget - refs, start_age: null, end_age: null, inflation_hundredths: null, essential: true }, ...(scope === 'complete' ? r.spend_items : []).filter(s => allowed(`spend:${s.id}`, b.retirement_costs)).map(s => ({ ...s, monthly_cents: Number(s.monthly_cents) }))];
  const flows: Flow[] = [];
  if (scope === 'complete' && Number(r.rent_cents) > 0 && allowed('rent', b.retirement_costs)) flows.push({ source_id: 'rent', label: '房租', from_month: now, to_month: null, cents: Number(r.rent_cents), nominal: false, essential: true, prorate_first: true });
  if (scope === 'complete' && Number(r.keep_paying_monthly_cents) > 0 && allowed('social_insurance', b.retirement_costs)) {
    if (r.keep_paying_until_age === null) {
      annotations.push({ id: 'social_insurance:period', reason_code: 'COST_PERIOD_PENDING', message: '续缴社保的截止年龄待核对，该费用未计入。', effect: 'requirement_lower', treatment: 'omitted', source_ids: ['social_insurance'], missing_fields: ['截止年龄'], refinement: { owner: 'budget', field: 'keep_paying_until_age' } });
    }
    else flows.push({ source_id: 'social_insurance', label: '续缴社保', from_month: now, to_month: r.keep_paying_until_age * 12, cents: Number(r.keep_paying_monthly_cents), nominal: false, essential: true, prorate_first: true });
  }
  const savingFlows: Flow[] = [];
  for (const row of debtRows) {
    const d = row.saved;
    if (!d || row.linked || row.zero || row.entry.amount_cents === null || d.monthly_cents === null || d.last_month === null) continue;
    const flow = { source_id: `debt:${d.account_id}`, label: `${row.name}还款`, from_month: Math.max(now + 1, debtMonthIndex(d.start_month) - monthIndex(birth)), to_month: debtMonthIndex(d.last_month) - monthIndex(birth) + 1, nominal: true, essential: true, timing: 'start' as const };
    if (d.before === 'scheduled') savingFlows.push({ ...flow, cents: -Number(d.monthly_cents) });
    if (scope === 'complete' && d.after === 'scheduled') flows.push({ ...flow, cents: Number(d.monthly_cents) });
  }
  if (annual > 0 && pc.start_month && pc.stop_month) {
    const transfer = { source_id: 'personal_pension', label: '个人养老金现金转入', from_month: Math.max(now, monthIndex(pc.start_month) - monthIndex(birth)), to_month: Math.min(monthIndex(pc.stop_month) - monthIndex(birth), pen.unlock_age_months), nominal: true, essential: true, prorate_first: true };
    savingFlows.push({ ...transfer, cents: -annual / 12 });
    if (allowed('personal_pension', b.retirement_costs)) flows.push({ ...transfer, cents: annual / 12 });
  }
  const preRefs = b.contribution_costs.filter(s => sourcesPre.includes(s.source_id) && s.treatment === 'included').reduce((sum, s) => sum + Number(s.reference_cents), 0);
  const selectedIds = scope === 'complete' && (mode === 'manual' || mode === 'employee') ? selected.map(s => s.id) : [];
  const skeleton: Plan = { input_mode: 'basic', now_months: now, target_months: target, horizon_months: horizon, search_cap_months: horizon, mode: r.mode, assets_cents: available / basisFactor, saving_cents: 0, saving_growth_hundredths: 0, r_before_hundredths: r.real_return_before_hundredths, r_after_hundredths: r.real_return_after_hundredths, inflation_hundredths: p.assumptions.inflation_hundredths, volatility_hundredths: r.volatility_hundredths, items, incomes: r.income_items.filter(i => selectedIds.includes(i.id)).map(i => ({ ...i, monthly_cents: Number(i.monthly_cents) })), pension_at: () => pen, spends: [], spend_flows: flows, saving_flows: savingFlows, rent_cents: allowed('rent', b.retirement_costs) ? Number(r.rent_cents) : 0, anchor_date: anchor, calculation_date: sources.today, monetary_basis_date: core.monetary_basis_date, basis_factor: basisFactor, first_month_fraction: fraction, core, annotations, event_coverage: eventReview.coverage };
  const events = active.map(eventValue);
  const compile = (amount: number, before: number, after: number, future = true): Plan => {
    const listed = events.filter(e => future || core.occurrences.some(o => o.event_id === e.id && o.status === 'occurred'));
    const withEvents = applyEvents({ ...skeleton, saving_cents: amount, r_before_hundredths: before, r_after_hundredths: after }, listed.map(e => ({ e, offset: offsetOf(e.date, anchor) })));
    // References stay throughout the confirmed scope, even after the source ends.
    return { ...withEvents, saving_phases: undefined, saving_flows: [...(withEvents.saving_flows ?? []).filter(f => !f.source_id || !sourcesPre.includes(f.source_id) || allowed(f.source_id, b.contribution_costs)), { label: '净投入已含费用还原', from_month: now, to_month: null, cents: preRefs, nominal: false, essential: false, prorate_first: true }], spend_flows: (withEvents.spend_flows ?? []).filter(f => !f.source_id || !sourcesPost.includes(f.source_id) || allowed(f.source_id, b.retirement_costs)) };
  };
  return { context, annotations, funds, pension, predictionMissing, plan: { status: 'ready', value: { compile, contribution, included_reference_cents: preRefs,
    target_month: ym(monthIndex(birth) + (r.target_age ?? r.horizon_age) * 12), horizon_month: ym(monthIndex(birth) + horizon),
    before: r.real_return_before_hundredths, after: r.real_return_after_hundredths } } };
}

/** Ready results can have incomplete coverage; annotations are part of every consumer context. */
export function buildBasicCapabilities(sources: PlanningSources, temporaryContribution?: string): BasicCapabilities {
  const prepared = prepareBasicPlan(sources, temporaryContribution);
  const { context, funds, pension, predictionMissing } = prepared;
  const annotations = uniqueAnnotations(prepared.annotations);
  if (prepared.plan.status === 'blocked') return { context, annotations, funds, pension, requirement: blocked(prepared.plan.missing), prediction: blocked(predictionMissing) };
  const { compile, contribution, before, after, target_month, horizon_month } = prepared.plan.value;
  const set = solveBasicRequirement(compile, before, after);
  const lower = solveBasicRequirement(compile, before - 200, after - 200);
  const upper = solveBasicRequirement(compile, before + 200, after + 200);
  const requirement: Capability<RequirementValue> = { status: 'ready', value: { set, lower, upper, target_month, horizon_month, budget_scope: 'complete' } };
  let prediction: Capability<PredictionValue> = blocked(predictionMissing);
  if (!predictionMissing.length && contribution !== null) {
    const plan = compile(Number(contribution), before, after), plan0 = compile(Number(contribution), before, after, false);
    const projection = project(plan, Number(plan.anchor_date!.slice(0, 4))), out = outcome(plan, projection);
    prediction = { status: 'ready', value: { source: temporaryContribution === undefined ? 'saved' : 'temporary', contribution_cents: contribution, plan, plan0, projection, outcome: out, terminal: !out.success ? 'gap' : Math.abs(out.at_horizon) < 0.5 ? 'no_margin' : 'surplus' } };
  }
  return { context, annotations, funds, requirement, prediction, pension };
}
