// Basic requirements and confirmed predictions share the existing full month ledger.
import type { FutureIncomeV1 } from './plan-simplified-contract.ts';
import type { StoredLifeEvent } from './plan.ts';
import type { BasicCapabilities, PlanningSources, PlanningMissing, Capability, RequirementResult, RequirementValue, PredictionValue, PlanningContext, CostScope, CapabilityName, PlanningAnnotation } from './plan-basic-contract.ts';
import { normalizeFunds, costSources, mustStayInLedger } from './plan-core.ts';
import { applyEvents, monthIndex, offsetOf } from './plan-events.ts';
import type { LifeEvent } from './plan-events.ts';
import { project, outcome } from './plan-ledger.ts';
import { enginePlan, engineRequest, planningModelVersion } from './planning-engine.ts';
import type { Plan, Flow, SpendItem, Projection } from './plan-ledger.ts';
import { basicConstraintMessages } from './plan-basic-validation.ts';
import { eventCoverage } from './plan-coverage.ts';
import { uniqueAnnotations } from './plan-annotations.ts';
import { debtReview, debtMonthIndex } from './plan-debt.ts';
import { monthIndexV1, monthTextV1 } from './plan-simplified.ts';

const PARTNER_INCOME_ID = 'household-partner-work';
export const BASIC_SEARCH_LIMIT_CENTS = 100_000_000;
const missing = (code: PlanningMissing['code'], capability: CapabilityName, owner: PlanningMissing['owner'], field: string, message: string, kind: PlanningMissing['kind'] = 'assumption'): PlanningMissing => ({ code, capability, owner, field, message, kind });
const blocked = <T>(items: PlanningMissing[]): Capability<T> => ({ status: 'blocked', missing: items });
const eventValue = (e: StoredLifeEvent): LifeEvent => ({ ...e, price_cents: Number(e.price_cents), down_cents: Number(e.down_cents), extra_cents: Number(e.extra_cents), holding_cents: Number(e.holding_cents), rent_saved_cents: Number(e.rent_saved_cents), resale_cents: Number(e.resale_cents) });
const validSigned = (s: string) => /^-?(0|[1-9]\d*)$/.test(s) && Number.isSafeInteger(Number(s)) && Math.abs(Number(s)) <= BASIC_SEARCH_LIMIT_CENTS && String(Number(s)) === s;

/** Candidates are computation variables, never profile patches or prediction outputs. Dates/pension/fees are fixed. */
export type BasicCompile = ((amount: number, before: number, after: number, future?: boolean) => Plan) & { household_share_cents?: number };
export function solveBasicRequirement(compile: BasicCompile, before: number, after: number, contributionFrom?: number): RequirementResult {
  const rates = { before_hundredths: before, after_hundredths: after };
  if (before < -1000 || before > 2000 || after < -1000 || after > 2000) return { ...rates, status: 'out_of_bounds', message: '调整后的实际收益超出允许范围，本条件未应用。' };
  type Solved = { status: 'payment_constraint' } | { status: 'not_applicable'; required_now: number }
    | { status: 'no_positive_contribution'; monthly_cents: '0' } | { status: 'found'; monthly_cents: string }
    | { status: 'search_not_found'; search_limit_cents: string };
  // The engine needs zero base saving; the split's -share is restored as the generated income, so only the base is reset.
  const base = compile(0, before, after), solverPlan = compile.household_share_cents ? { ...base, saving_cents: 0 } : base;
  const solved = engineRequest<Solved>({ op: 'solve_contribution', plan: enginePlan(solverPlan), contribution_from_month: contributionFrom, search_limit_cents: BASIC_SEARCH_LIMIT_CENTS });
  if (solved.status === 'payment_constraint') return { ...rates, status: solved.status, message: contributionFrom === undefined
    ? '起点已有资金不足以支付首月付款；月底投入不能补月初支付，请补现有资金或调整付款时间。'
    : '开始这段投入前的已知付款不足；之后的投入不能补救，请核对现有资金和付款时间。' };
  if (solved.status === 'not_applicable') return { ...rates, status: solved.status, message: '没有目标前积累区间；当前退休所需 ' + Math.ceil(solved.required_now) + ' 分，需核对现有资金。' };
  // Household split (couple, partner works longer than me): the engine solves
  // the plan's own saving_cents, i.e. "my part". The result is reported as the
  // HOUSEHOLD total while the partner still works (my part + partner share), so
  // it stays comparable with the household total the user enters and every
  // existing consumer (monthly_cents vs contribution) keeps its meaning. The
  // partner share is exposed on the compiler (`household_share_cents`).
  if (solved.status === 'found' && compile.household_share_cents) return { ...rates, ...solved, monthly_cents: String(Number(solved.monthly_cents) + compile.household_share_cents) };
  return { ...rates, ...solved };
}

/** Resolved partner timing for a couple (months YYYY-MM). split is set only when the saving is divided and a generated income is added. */
export type HouseholdPlan = { partner_stop_month: string | null; share_cents: number | null };
export type BasicPlanCompiler = {
  included_reference_cents: number;
  compile: BasicCompile;
  contribution: string | null;
  target_month: string;
  horizon_month: string;
  /** Couple with a known later partner stop: the split share, else null. */
  household: HouseholdPlan | null;
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
  const context: PlanningContext = { generation: sources.generation, revision: saved?.revision ?? null, today: sources.today, model_version: planningModelVersion, modules: { ...sources.modules }, start, monetary_basis_date: r?.core?.monetary_basis_date ?? null, source: temporaryContribution === undefined ? 'saved' : 'temporary', write_version: sources.write_version };
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
  if (!core) reqMissing.push(missing('FUNDS_UNCONFIRMED', 'requirement', 'funds', 'core.monetary_basis_date', '请确认金额对应的日期（用于统一购买力）。'));
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
    for(const id of ids) if(!scopes.some(c=>c.source_id===id)) annotations.push({id:`cost:${field}:${id}`,reason_code:'COST_ASSUMED_EXTRA',message:'请确认费用是否已包含；暂按额外费用计入，可能重复包含。',effect:'requirement_higher',treatment:'assumed_extra',source_ids:[id],missing_fields:['费用包含关系'],refinement:{owner:'budget',field}});
  };
  check(sourcesPre,b.contribution_costs,'basic.contribution_costs',true);
  if(scope==='complete') check(sourcesPost,b.retirement_costs,'basic.retirement_costs',false);
  const refs=scope==='complete'?b.retirement_costs.filter(s=>sourcesPost.includes(s.source_id)&&s.treatment==='included').reduce((sum,s)=>sum+Number(s.reference_cents),0):0;
  if(r.spend_cents!==null && refs>Number(r.spend_cents)) reqMissing.push(missing('COST_SCOPE_INVALID','requirement','budget','basic.retirement_costs','已含参考额超过预算。'));
  if(anchor && f.time.horizon_month && monthIndex(f.time.horizon_month)<monthIndex(anchor)) reqMissing.push(missing('HORIZON_INVALID','requirement','basic','time.horizon_month','终点早于资金起点。','constraint'));
  if(anchor && f.time.horizon_month && monthIndex(f.time.horizon_month)-monthIndex(anchor)+1>1440) reqMissing.push(missing('HORIZON_INVALID','requirement','basic','time.horizon_month','规划最多覆盖 1440 个月（包含起点月与终点月），请调整终点月份。','constraint'));
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
      annotations.push({id:`release:${release.id}`,reason_code:'TRANSFER_PENDING',message:'暂时取不出的钱的金额、时间、现有余额或资金来源待确认，该转移未计入。',effect:'uncertain',treatment:'omitted',source_ids:[release.account_id],missing_fields:['通用可用安排'],refinement:{owner:'funds',field:`core.releases.${release.id}`}});continue;
    }
    transfers.push({id:release.id,account_id:release.account_id,month:monthIndex(release.month)-monthIndex(anchor),cents:amount,nominal_cents:amount});
  }
  const preRefs=b.contribution_costs.filter(s=>sourcesPre.includes(s.source_id)&&s.treatment==='included').reduce((sum,s)=>sum+Number(s.reference_cents),0);
  const skeleton:Plan={input_mode:'basic',now_months:now,target_months:target,horizon_months:horizon,search_cap_months:horizon-1,mode:r.mode,assets_cents:available/basisFactor,saving_cents:0,saving_growth_hundredths:0,r_before_hundredths:r.real_return_before_hundredths,r_after_hundredths:r.real_return_after_hundredths,inflation_hundredths:p.assumptions.inflation_hundredths,volatility_hundredths:r.volatility_hundredths,items,incomes:[],future_incomes:selected.filter(i=>!incomplete.includes(i)),transfers,pension_at:()=>({monthly_cents:0,lump_cents:0,unlock_age_months:horizon+1,income_start_age_months:null,eligible:false,short_months:0}),spends:[],spend_flows:flows,saving_flows:savingFlows,rent_cents:allowed('rent',b.retirement_costs)?Number(r.rent_cents):0,anchor_date:anchor,calculation_date:sources.today,monetary_basis_date:core.monetary_basis_date,basis_factor:basisFactor,first_month_fraction:fraction,core,annotations,event_coverage:eventReview.coverage,age_reference:f.time.reference};
  // Household (couple): only a known share plus a partner stop after the plan anchor month splits the saving.
  // Everything else (single, stops with me, unknown share, already stopped) leaves the plan untouched.
  const hh=f.household, partner=hh?.mode==='couple'?hh.partner:null;
  let partnerStop:string|null=null, share:number|null=null;
  if(partner && partner.stop_age_months!==null){
    partnerStop=monthTextV1(monthIndexV1(partner.birth_month)+partner.stop_age_months);
    if(monthIndexV1(partnerStop)<=monthIndexV1(anchor)){
      annotations.push({id:'household:partner-stopped',reason_code:'HOUSEHOLD_PARTNER_STOPPED',message:'伴侣停工月份已过，伴侣存款不再单独计算；请确认每月一共能存多少已不含伴侣。',effect:'uncertain',treatment:'omitted',source_ids:[],missing_fields:['每月一共能存'],refinement:{owner:'basic',field:'household.partner.stop_age_months'}});
    } else if(partner.monthly_cents===null){
      annotations.push({id:'household:share-unknown',reason_code:'HOUSEHOLD_SHARE_UNKNOWN',message:'伴侣每月存多少未填，暂按两人同时停工计算。',effect:'uncertain',treatment:'omitted',source_ids:[],missing_fields:['伴侣每月存款'],refinement:{owner:'basic',field:'household.partner.monthly_cents'}});
    } else share=Number(partner.monthly_cents);
  }
  const anchorMonth=anchor.slice(0,7);
  const partnerIncome:FutureIncomeV1|null=share===null||partnerStop===null?null:{id:PARTNER_INCOME_ID,name:'伴侣停工前的结余',role:'other',included:true,monthly_cents:String(share),start_month:anchorMonth,end_month:monthTextV1(monthIndexV1(partnerStop)-1),basis:'reference_month',basis_month:anchorMonth,growth:'constant_purchasing_power',source:null,source_checked_on:null,notes:''};
  const compile:BasicCompile=(amount:number,before:number,after:number,future=true):Plan=>{
    const listed=active.filter(e=>future || core.occurrences.some(o=>o.event_id===e.id&&o.status==='occurred'));
    const withEvents=applyEvents({...skeleton,saving_cents:share===null?amount:amount-share,r_before_hundredths:before,r_after_hundredths:after},listed.map(e=>({e:eventValue(e),offset:offsetOf(e.date,anchor)})));
    // Expired factual schedules have no future cash flow. Keep malformed future
    // intervals for kernel validation instead of silently hiding them.
    const remaining = (flow: Flow) => {
      if (!Number.isFinite(flow.from_month) || (flow.to_month !== null && !Number.isFinite(flow.to_month))) return true;
      return flow.to_month === null || (flow.to_month > now && flow.to_month !== flow.from_month);
    };
    const built={...withEvents,saving_flows:[...(withEvents.saving_flows??[]).filter(f=>remaining(f) && (!f.source_id || !sourcesPre.includes(f.source_id) || allowed(f.source_id,b.contribution_costs))),{label:'投入里已含费用',from_month:now,to_month:null,cents:preRefs,nominal:false,essential:false,prorate_first:true}],spend_flows:(withEvents.spend_flows??[]).filter(f=>remaining(f) && (!f.source_id || !sourcesPost.includes(f.source_id) || allowed(f.source_id,b.retirement_costs)))};
    return partnerIncome?{...built,future_incomes:[...built.future_incomes??[],partnerIncome]}:built;
  };
  if(share!==null)compile.household_share_cents=share;
  return {context,annotations,funds,pension,predictionMissing,plan:{status:'ready',value:{compile,contribution,included_reference_cents:preRefs,target_month:f.time.target_month,horizon_month:f.time.horizon_month,household:partner&&partner.stop_age_months!==null?{partner_stop_month:partnerStop,share_cents:share}:partner?{partner_stop_month:null,share_cents:null}:null,before:r.real_return_before_hundredths,after:r.real_return_after_hundredths}}};
}

/** My stop month (YYYY-MM): the projected retirement month in FIRE mode, the fixed target month otherwise; null when FIRE is not reached. */
function stopMonthOf(plan: Plan, projection: Projection): string | null {
  const offset = plan.mode === 'fire' ? projection.retire_month : plan.target_months;
  return offset === null ? null : monthTextV1(monthIndexV1(plan.anchor_date!) + offset - plan.now_months);
}

export function buildBasicCapabilities(sources: PlanningSources, temporaryContribution?: string): BasicCapabilities {
  const prepared = prepareBasicPlan(sources, temporaryContribution);
  const { context, funds, pension, predictionMissing } = prepared;
  const annotations = uniqueAnnotations(prepared.annotations);
  if (prepared.plan.status === 'blocked') return { context, annotations, funds, pension, requirement: blocked(prepared.plan.missing), prediction: blocked(predictionMissing) };
  const { compile, contribution, before, after, target_month, horizon_month, household } = prepared.plan.value;
  const set = solveBasicRequirement(compile, before, after);
  const lower = solveBasicRequirement(compile, before - 200, after - 200);
  const upper = solveBasicRequirement(compile, before + 200, after + 200);
  const requirement: Capability<RequirementValue> = { status: 'ready', value: { set, lower, upper, target_month, horizon_month, budget_scope: 'complete' } };
  let prediction: Capability<PredictionValue> = blocked(predictionMissing);
  if (!predictionMissing.length && contribution !== null) {
    const plan = compile(Number(contribution), before, after), plan0 = compile(Number(contribution), before, after, false);
    const projection = project(plan, Number(plan.anchor_date!.slice(0, 4))), out = outcome(plan, projection);
    const value: PredictionValue = { source: temporaryContribution === undefined ? 'saved' : 'temporary', contribution_cents: contribution, plan, plan0, projection, outcome: out, terminal: !out.success ? 'gap' : Math.abs(out.at_horizon) < 0.5 ? 'no_margin' : 'surplus' };
    if (household) {
      const mine = stopMonthOf(plan, projection);
      let sameTime: string | null = null;
      if (household.share_cents !== null) {
        // One extra engine run: the same household total, no split, partner stops with me.
        const unsplit: Plan = { ...plan, saving_cents: plan.saving_cents + household.share_cents, future_incomes: (plan.future_incomes ?? []).filter(i => i.id !== PARTNER_INCOME_ID) };
        sameTime = stopMonthOf(unsplit, project(unsplit, Number(unsplit.anchor_date!.slice(0, 4))));
      }
      const later = mine !== null && household.partner_stop_month !== null ? (monthIndexV1(mine) >= monthIndexV1(household.partner_stop_month) ? mine : household.partner_stop_month) : mine;
      value.household = { partner_stop_month: household.partner_stop_month, both_stop_month: later, same_time_stop_month: sameTime };
    }
    prediction = { status: 'ready', value };
  }
  return { context, annotations, funds, requirement, prediction, pension };
}
