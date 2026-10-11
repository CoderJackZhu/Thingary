// Basic requirements and confirmed predictions share the existing full month ledger.
import type { StoredLifeEvent } from './plan.ts';
import type { BasicCapabilities, PlanningSources, PlanningMissing, Capability, RequirementResult, RequirementValue, PredictionValue, PlanningContext, CostScope, CapabilityName, PlanningAnnotation } from './plan-basic-contract.ts';
import { normalizeFunds, costSources, mustStayInLedger } from './plan-core.ts';
import { applyEvents, monthIndex, offsetOf } from './plan-events.ts';
import type { LifeEvent } from './plan-events.ts';
import { project, outcome, required, startPaymentsOf, oneOffsOf } from './plan-ledger.ts';
import type { Plan, Flow, SpendItem } from './plan-ledger.ts';
import { basicConstraintMessages } from './plan-basic-validation.ts';
import { eventCoverage } from './plan-coverage.ts';
import { uniqueAnnotations } from './plan-annotations.ts';
import { debtReview, debtMonthIndex } from './plan-debt.ts';

export const BASIC_SEARCH_LIMIT_CENTS = 100_000_000;
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

import { validateSimplifiedPlanningV1, validMonthV1 } from './plan-simplified.ts';
/** Only current explicit calendar months and general cash flows reach the ledger. */
export function prepareBasicPlan(sources: PlanningSources, temporaryContribution?: string, scope: 'complete' | 'accumulation' = 'complete', options: { includePools?: boolean } = {}): BasicPlanPreparation {
  const state = sources.profile.status === 'ready' ? sources.profile.value : null;
  const saved = state?.saved ?? null, p = saved?.profile, r = p?.retire, b = r?.basic;
  const snap = sources.modules.wealth && sources.snapshot.status === 'ready' ? sources.snapshot.value : null;
  const start: PlanningContext['start'] = b?.start.kind === 'simulation' ? { kind: 'simulation', id: b.start.id, date: b.start.date } : { kind: 'live', snapshot_id: snap?.id ?? null, revision: snap?.revision ?? null, date: snap?.date ?? null };
  const context: PlanningContext = { generation: sources.generation, revision: saved?.revision ?? null, today: sources.today, model_version: 'simplified-1', modules: { ...sources.modules }, start, monetary_basis_date: r?.core?.monetary_basis_date ?? null, source: temporaryContribution === undefined ? 'saved' : 'temporary', write_version: sources.write_version };
  const annotations: PlanningAnnotation[] = [], baseMissing: PlanningMissing[] = [];
  if (!sources.modules.planning) baseMissing.push(missing('SOURCE_ERROR', 'requirement', 'service', 'modules.planning', '规划模块已关闭。', 'read_error'));
  if (sources.profile.status === 'error') baseMissing.push(missing('SOURCE_ERROR', 'requirement', 'service', 'profile', sources.profile.value.message, 'read_error'));
  else if (!p || !b) baseMissing.push(missing('PROFILE_UNKNOWN', 'requirement', 'basic', 'retire.basic', '请重新确认通用规划条件。'));
  if (state && state.generation !== sources.generation) baseMissing.push(missing('SOURCE_STALE', 'requirement', 'service', 'generation', '来源身份已变化，请重新读取。', 'read_error'));
  for (const message of basicConstraintMessages(sources)) baseMissing.push(missing('INPUT_INVALID', 'requirement', 'basic', 'inputs', message, 'constraint'));
  if (!p || !r || !b || baseMissing.length) return { context, annotations, funds: blocked(baseMissing.map(x => ({ ...x, capability: 'funds' }))), plan: blocked(baseMissing), predictionMissing: baseMissing.map(x => ({ ...x, capability: 'prediction' })), pension: blocked(baseMissing.map(x => ({ ...x, capability: 'pension' }))) };
  const f = r.simplified, core = r.core;
  const fundMissing: PlanningMissing[] = [];
  let available: number | null = null, restricted = 0, debt = 0, anchor: string | null = null;
  if (b.start.kind === 'simulation') {
    available = b.start.available_cents === null ? null : Number(b.start.available_cents); anchor = b.start.date;
    if (available === null || anchor === null) fundMissing.push(missing('START_UNKNOWN', 'funds', 'basic', 'basic.start', '请明确模拟起点金额与截至日。'));
  } else if (!sources.modules.wealth) fundMissing.push(missing('WEALTH_DISABLED', 'funds', 'basic', 'basic.start', '财富模块已关闭；可明确使用模拟起点。', 'read_error'));
  else if (sources.snapshot.status === 'error') fundMissing.push(missing('SOURCE_ERROR', 'funds', 'service', 'snapshot', sources.snapshot.value.message, 'read_error'));
  else {
    const normalized = normalizeFunds(snap, core); available = normalized.available; restricted = normalized.restricted; debt = normalized.debt; anchor = snap?.date ?? null;
    for (const message of normalized.missing) fundMissing.push(missing(snap ? 'FUNDS_UNCONFIRMED' : 'START_UNKNOWN', 'funds', 'funds', 'core.fund_rules', message));
  }
  const funds: BasicCapabilities['funds'] = fundMissing.length || available === null || anchor === null ? blocked(fundMissing) : { status: 'ready', value: { available_cents: String(Math.round(available)), restricted_cents: String(Math.round(restricted)), debt_cents: String(Math.round(debt)), date: anchor, kind: b.start.kind } };
  const reqMissing: PlanningMissing[] = fundMissing.map(x => ({ ...x, capability: 'requirement' }));
  for (const issue of validateSimplifiedPlanningV1(f)) reqMissing.push(missing('INPUT_INVALID', 'requirement', 'basic', issue.path, issue.message, 'constraint'));
  if (f.time.target_month === null || f.time.horizon_month === null) reqMissing.push(missing('TIME_UNCONFIRMED', 'requirement', 'basic', 'time.target_month', '规划条件已简化，请重新确认目标与终点月份。'));
  if (r.spend_cents === null && scope === 'complete') reqMissing.push(missing('BUDGET_UNKNOWN', 'requirement', 'budget', 'spend_cents', '请确认完整生活预算。'));
  if (!core) reqMissing.push(missing('FUNDS_UNCONFIRMED', 'requirement', 'funds', 'core.monetary_basis_date', '请确认金额基准。'));
  if (f.income_mode === 'unconfirmed' && scope === 'complete') reqMissing.push(missing('INCOME_UNCONFIRMED', 'requirement', 'basic', 'income_mode', '请选择本次不计收入或填写预计收入。'));
  const selected = f.income_mode === 'manual' ? f.future_incomes.filter(i => i.included) : [];
  const incomplete = selected.filter(i => i.monthly_cents === null || i.start_month === null);
  for (const i of incomplete) annotations.push({ id: `income:${i.id}`, reason_code: 'INCOME_INCOMPLETE', message: `${i.name}金额或开始月未知，该项未计入；结果仅覆盖其余条件。`, effect: 'requirement_higher', treatment: 'omitted', source_ids: [i.id], missing_fields: ['金额／开始月'], refinement: { owner: 'basic', field: `future_incomes.${i.id}` } });
  const pension: BasicCapabilities['pension'] = f.income_mode === 'unconfirmed' ? blocked([missing('INCOME_UNCONFIRMED', 'pension', 'basic', 'income_mode', '未来收入未确认。')]) : { status: 'ready', value: { included: selected.some(i => i.role === 'pension'), start_month: null, monthly_cents: null, incomplete_ids: incomplete.map(i => i.id) } };
  const active = r.life_events.filter(e => e.included || core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred'));
  const eventReview = eventCoverage(active, core, snap, sources.today, saved?.reference_issues ?? [], {targetMonth:f.time.target_month ?? undefined,horizonMonth:f.time.horizon_month ?? undefined,accounts:sources.accounts.status==='ready'?sources.accounts.value:[]});
  annotations.push(...eventReview.annotations);
  const debtRows = snap ? debtReview(snap, core, active).rows : [];
  for (const i of r.spend_items.filter(i => i.time_unconfirmed)) annotations.push({ id:`spend:${i.id}:time`, reason_code:'TIME_PENDING', message:`${i.label}的起止月份待重设，该额外费用未计入。`,effect:'requirement_lower',treatment:'omitted',source_ids:[i.id],missing_fields:['起止月份'],refinement:{owner:'budget',field:`spend_items.${i.id}`} });
  for (const e of active.filter(e => e.time_unconfirmed)) annotations.push({ id:`event:${e.id}:time`, reason_code:'TIME_PENDING', message:`${e.label}的持有／循环终点待重设，该部分未计入。`,effect:'requirement_lower',treatment:'omitted',source_ids:[e.id],missing_fields:['终点月份'],refinement:{owner:'events',field:`life_events.${e.id}`,event_id:e.id} });
  const sourceRows = costSources(active).filter(s => {
    const event = active.find(e => s.id === `event:${e.id}:loan` || s.id === `event:${e.id}:holding`);
    if (!event) return true;
    const review = eventReview.coverage[event.id]; return !review.paused && (s.id.endsWith(':loan') ? review.loan : review.holding && !event.time_unconfirmed);
  });
  const sourcesPre = [...new Set([...sourceRows.map(s => s.id), ...(core?.occurrences ?? []).filter(o => o.status === 'occurred' && eventReview.coverage[o.event_id]?.loan && o.loan && Number(o.loan.principal_cents) > 0).map(o => `event:${o.event_id}:loan`)])];
  const sourcesPost = [...sourcesPre, ...r.spend_items.filter(i=>!i.time_unconfirmed).map(s=>`spend:${s.id}`), ...(Number(r.rent_cents)>0?['rent']:[])];
  const known = [...new Set([...sourcesPre,...costSources(r.life_events).map(s=>s.id),...r.spend_items.map(s=>`spend:${s.id}`),'rent'])];
  const allowed = (id: string, scopes: CostScope[]) => scopes.find(s => s.source_id === id)?.treatment !== 'excluded';
  const check = (ids: string[], scopes: CostScope[], field: string, pre: boolean) => {
    const seen=new Set<string>();
    for(const c of scopes) {
      if(!known.includes(c.source_id) || seen.has(c.source_id)) reqMissing.push(missing('COST_SCOPE_INVALID','requirement','budget',field,'费用来源失效或重复。'));
      seen.add(c.source_id);
      if(!ids.includes(c.source_id)) continue;
      const occurred=core?.occurrences.some(o=>o.status==='occurred' && c.source_id.startsWith(`event:${o.event_id}:`));
      if(c.treatment==='included' && (c.reference_cents===null || (pre && c.source_id.startsWith('event:') && !occurred))) reqMissing.push(missing('COST_SCOPE_INVALID','requirement','budget',field,'已含费用缺参考额或尚未发生。'));
      if(c.treatment==='excluded' && mustStayInLedger(c.source_id)) reqMissing.push(missing('COST_SCOPE_INVALID','requirement','events',field,'贷款必须计入。','constraint'));
    }
    for(const id of ids) if(!scopes.some(c=>c.source_id===id)) annotations.push({id:`cost:${field}:${id}`,reason_code:'COST_ASSUMED_EXTRA',message:'费用包含关系待核对，暂按额外计入。',effect:'requirement_higher',treatment:'assumed_extra',source_ids:[id],missing_fields:['费用包含关系'],refinement:{owner:'budget',field}});
  };
  check(sourcesPre,b.contribution_costs,'basic.contribution_costs',true);
  if(scope==='complete') check(sourcesPost,b.retirement_costs,'basic.retirement_costs',false);
  const refs=scope==='complete'?b.retirement_costs.filter(s=>sourcesPost.includes(s.source_id)&&s.treatment==='included').reduce((sum,s)=>sum+Number(s.reference_cents),0):0;
  if(r.spend_cents!==null && refs>Number(r.spend_cents)) reqMissing.push(missing('COST_SCOPE_INVALID','requirement','budget','basic.retirement_costs','已含参考额超过预算。'));
  if(anchor && f.time.horizon_month && monthIndex(f.time.horizon_month)<monthIndex(anchor)) reqMissing.push(missing('HORIZON_INVALID','requirement','basic','time.horizon_month','终点早于资金起点。','constraint'));
  const contribution=temporaryContribution===undefined?b.contribution.monthly_cents:temporaryContribution;
  const predictionMissing:PlanningMissing[]=reqMissing.map(x=>({...x,capability:'prediction' as const}));
  if(contribution===null || !validSigned(contribution)) predictionMissing.push(missing('CONTRIBUTION_UNKNOWN','prediction','basic','basic.contribution.monthly_cents','预计投入未知或非法；需求仍可计算。'));
  if(reqMissing.length || funds.status!=='ready' || !anchor || !core || available===null || !validMonthV1(f.time.target_month) || !validMonthV1(f.time.horizon_month) || (scope==='complete' && r.spend_cents===null)) return {context,annotations,funds,plan:blocked(reqMissing),predictionMissing,pension};
  const now=0, target=Math.max(0,monthIndex(f.time.target_month)-monthIndex(anchor)), horizon=monthIndex(f.time.horizon_month)-monthIndex(anchor)+1;
  const basisFactor=(1+p.assumptions.inflation_hundredths/10000)**((Date.parse(anchor)-Date.parse(core.monetary_basis_date))/(86400000*365.25));
  const days=new Date(Date.UTC(+anchor.slice(0,4),+anchor.slice(5,7),0)).getUTCDate(), fraction=(days-+anchor.slice(8,10))/days;
  const items:SpendItem[]=[{id:'living',label:'总预算其他部分',monthly_cents:(scope==='complete'?Number(r.spend_cents):0)-refs,start_age:null,end_age:null,inflation_hundredths:null,essential:true},...r.spend_items.filter(s=>scope==='complete' && !s.time_unconfirmed && allowed(`spend:${s.id}`,b.retirement_costs)).map(s=>({id:s.id,label:s.label,monthly_cents:Number(s.monthly_cents),start_age:s.start_month===null?null:(monthIndex(s.start_month)-monthIndex(anchor))/12,end_age:s.end_month===null?null:(monthIndex(s.end_month)-monthIndex(anchor)+1)/12,inflation_hundredths:s.inflation_hundredths,essential:s.essential}))];
  const flows:Flow[]=scope==='complete' && Number(r.rent_cents)>0 && allowed('rent',b.retirement_costs)?[{source_id:'rent',label:'房租',from_month:0,to_month:null,cents:Number(r.rent_cents),nominal:false,essential:true,prorate_first:true}]:[];
  const savingFlows:Flow[]=[];
  for(const row of debtRows){const d=row.saved;if(!d || row.linked || row.zero || row.entry.amount_cents===null || d.monthly_cents===null || d.last_month===null)continue;
    const flow={source_id:`debt:${d.account_id}`,label:`${row.name}还款`,from_month:Math.max(1,debtMonthIndex(d.start_month)-monthIndex(anchor)),to_month:debtMonthIndex(d.last_month)-monthIndex(anchor)+1,nominal:true,essential:true,timing:'start' as const};
    if(d.before==='scheduled')savingFlows.push({...flow,cents:-Number(d.monthly_cents)});
    if(scope==='complete' && d.after==='scheduled')flows.push({...flow,cents:Number(d.monthly_cents)});
  }
  const transfers:NonNullable<Plan['transfers']>=[];
  for(const release of options.includePools===false?[]:core.releases){
    const entry=b.start.kind==='live'?snap?.entries.find(e=>e.account_id===release.account_id && e.counted && e.side==='asset'):null;
    const rule=core.fund_rules.find(f=>f.account_id===release.account_id);
    const amount=release.net_cents===null?null:Number(release.net_cents), balance=entry?.amount_cents==null?null:Number(entry.amount_cents)*(rule?.share_hundredths??0)/10000;
    if(!entry || rule?.availability!=='restricted' || amount===null || balance===null || release.month<anchor.slice(0,7) || !release.excludes_future_deposits || (amount>balance && !release.estimated)) {
      annotations.push({id:`release:${release.id}`,reason_code:'TRANSFER_PENDING',message:'受限资金的金额、时间、现有余额或资金来源待确认，该转移未计入。',effect:'uncertain',treatment:'omitted',source_ids:[release.account_id],missing_fields:['通用可用安排'],refinement:{owner:'funds',field:`core.releases.${release.id}`}});continue;
    }
    transfers.push({id:release.id,account_id:release.account_id,month:monthIndex(release.month)-monthIndex(anchor),cents:amount,nominal_cents:amount});
  }
  const preRefs=b.contribution_costs.filter(s=>sourcesPre.includes(s.source_id)&&s.treatment==='included').reduce((sum,s)=>sum+Number(s.reference_cents),0);
  const skeleton:Plan={input_mode:'basic',now_months:now,target_months:target,horizon_months:horizon,search_cap_months:horizon-1,mode:r.mode,assets_cents:available/basisFactor,saving_cents:0,saving_growth_hundredths:0,r_before_hundredths:r.real_return_before_hundredths,r_after_hundredths:r.real_return_after_hundredths,inflation_hundredths:p.assumptions.inflation_hundredths,volatility_hundredths:r.volatility_hundredths,items,incomes:[],future_incomes:selected.filter(i=>!incomplete.includes(i)),transfers,pension_at:()=>({monthly_cents:0,lump_cents:0,unlock_age_months:horizon+1,income_start_age_months:null,eligible:false,short_months:0}),spends:[],spend_flows:flows,saving_flows:savingFlows,rent_cents:allowed('rent',b.retirement_costs)?Number(r.rent_cents):0,anchor_date:anchor,calculation_date:sources.today,monetary_basis_date:core.monetary_basis_date,basis_factor:basisFactor,first_month_fraction:fraction,core,annotations,event_coverage:eventReview.coverage,age_reference:f.time.reference};
  const compile=(amount:number,before:number,after:number,future=true):Plan=>{
    const listed=active.filter(e=>future || core.occurrences.some(o=>o.event_id===e.id&&o.status==='occurred'));
    const withEvents=applyEvents({...skeleton,saving_cents:amount,r_before_hundredths:before,r_after_hundredths:after},listed.map(e=>({e:eventValue(e),offset:offsetOf(e.date,anchor)})));
    return {...withEvents,saving_flows:[...(withEvents.saving_flows??[]).filter(f=>!f.source_id || !sourcesPre.includes(f.source_id) || allowed(f.source_id,b.contribution_costs)),{label:'投入里已含费用',from_month:now,to_month:null,cents:preRefs,nominal:false,essential:false,prorate_first:true}],spend_flows:(withEvents.spend_flows??[]).filter(f=>!f.source_id || !sourcesPost.includes(f.source_id) || allowed(f.source_id,b.retirement_costs))};
  };
  return {context,annotations,funds,pension,predictionMissing,plan:{status:'ready',value:{compile,contribution,included_reference_cents:preRefs,target_month:f.time.target_month,horizon_month:f.time.horizon_month,before:r.real_return_before_hundredths,after:r.real_return_after_hundredths}}};
}

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
