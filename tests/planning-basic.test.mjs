import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBasicCapabilities, solveBasicRequirement, BASIC_SEARCH_LIMIT_CENTS } from '../src/plan-basic.ts';
import { buildRetireCalc, routeCompare } from '../src/plan-retire-calc.ts';
import { defaultRetire } from '../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';
import { unknownBasicUpdate } from '../src/plan-basic-fixtures.ts';
import { project, outcome, table, savingsOf, startPaymentsOf, oneOffsOf, required, requiredAt } from '../src/plan-ledger.ts';
import { monteCarlo } from '../src/plan-risk.ts';
import { checkpoints, verdict } from '../src/plan-view.ts';
import { summaryRetire } from '../src/plan-summary.ts';
import { isReady, impactOf } from '../src/plan-wishes.ts';
import { planningReadSession } from '../src/planning-service.ts';
const ready = value => ({ status: 'ready', value });
const error = { status: 'error', value: { code: 'FICTIONAL', message: '虚构独立来源故障' } };
export function fictionalSources(contribution = null) {
  const f = structuredClone(unknownBasicUpdate.fields);
  f.basic.contribution.monthly_cents = contribution;
  const profile = { birth_month: f.birth_month, worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null, assumptions: { ...defaultAssumptions, inflation_hundredths: 0 }, overrides: noOverrides, retire: { ...structuredClone(defaultRetire), spend_cents: f.spend_cents, target_age: f.target_age, horizon_age: f.horizon_age, mode: f.mode, real_return_before_hundredths: f.real_return_before_hundredths, real_return_after_hundredths: f.real_return_after_hundredths, volatility_hundredths: f.volatility_hundredths, emergency_months: f.emergency_months, basic: f.basic, core: { contract_version: 1, monetary_basis_date: f.monetary_basis_date, fund_rules: [], hpf_monthly_cents: null, costs: [], occurrences: [] } } };
  return { generation: 'fictional', write_version: 1, today: '2026-10-07', modules: { planning: true, wealth: false }, profile: ready({ generation: 'fictional', saved: { revision: 1, updated_at: '2026-10-07', profile } }), snapshot: error, accounts: error, review: error, incomes: error };
}
const profile = s => s.profile.value.saved.profile;
const retire = s => profile(s).retire;
const prediction = s => { const c = buildBasicCapabilities(s); assert.equal(c.prediction.status, 'ready', JSON.stringify(c.prediction)); return c.prediction.value; };
const requirement = s => { const c = buildBasicCapabilities(s); assert.equal(c.requirement.status, 'ready', JSON.stringify(c.requirement)); return c.requirement.value; };
const stream = (id, amount) => ({ id, label: id, monthly_cents: String(amount), start_age: 0, end_age: null, indexed: true });
const item = (id, amount, essential = true) => ({ id, label: id, monthly_cents: String(amount), start_age: null, end_age: null, inflation_hundredths: null, essential });
const ledgerItem = (id, amount, essential = true) => ({ ...item(id, amount, essential), monthly_cents: amount });
const ledgerIncome = (id, amount) => ({ ...stream(id, amount), monthly_cents: amount });
const scope = (id, treatment, reference = null) => ({ source_id: id, treatment, reference_cents: reference });

test('B01/B01a/B02/B03/D21/D29/D33 unknown pension facts and failed history do not block simulated fixed-target requirements', () => {
  const s = fictionalSources(), before = structuredClone(s), c = buildBasicCapabilities(s);
  assert.equal(c.funds.value.available_cents, '10000000');
  assert.equal(c.pension.value.monthly_cents, null);
  assert.equal(c.prediction.status, 'blocked');
  assert.deepEqual(c.prediction.missing.map(m => m.code), ['CONTRIBUTION_UNKNOWN']);
  assert.equal(c.requirement.status, 'ready');
  assert.equal(c.requirement.value.target_month, '2050-06');
  // Independent closed-form check: first closing-month has zero contribution,
  // 284 full pre-target months then 360 full retirement months, zero returns.
  assert.equal(c.requirement.value.set.monthly_cents, String(Math.ceil((400000 * 360 - 10000000) / 284)));
  assert.deepEqual(s, before);
  assert.equal('plan' in c.prediction, false);
  const z = fictionalSources('0');
  assert.deepEqual(requirement(z), c.requirement.value);
  assert.equal(buildBasicCapabilities(z).prediction.status, 'ready');
  // Candidate 0 is only a requirement result, never a saved explicit contribution.
  retire(s).basic.start.available_cents = '900000000';
  assert.equal(requirement(s).set.status, 'no_positive_contribution');
  assert.equal(retire(s).basic.contribution.monthly_cents, null);
  assert.equal(buildBasicCapabilities(s).prediction.status, 'blocked');
});

test('B04/B05/D30 signed explicit predictions, fixed target and two independent return reductions', () => {
  for (const n of ['0', '100000', '-100000']) assert.equal(prediction(fictionalSources(n)).contribution_cents, n);
  const s = fictionalSources(), r = retire(s); r.mode = 'fire'; r.real_return_before_hundredths = 500; r.real_return_after_hundredths = 400;
  const before = structuredClone(s), req = requirement(s);
  const direct = structuredClone(s); retire(direct).real_return_before_hundredths -= 200; retire(direct).real_return_after_hundredths -= 200;
  assert.deepEqual(req.lower, requirement(direct).set);
  const up = structuredClone(s); retire(up).real_return_before_hundredths += 200; retire(up).real_return_after_hundredths += 200;
  assert.deepEqual(req.upper, requirement(up).set);
  assert.equal(req.upper.before_hundredths, 700);
  assert.deepEqual(s, before);
  const candidate = Number(req.set.monthly_cents), pred = prediction({...s, profile: ready({ ...s.profile.value, saved: { ...s.profile.value.saved, profile: { ...profile(s), retire: { ...r, basic: { ...r.basic, contribution: { ...r.basic.contribution, monthly_cents: String(candidate) } } } } } }) });
  const fixed = { ...pred.plan, mode: 'traditional' };
  assert.equal(outcome(fixed, project(fixed, 2026)).success, true);
  assert.equal(outcome({ ...fixed, saving_cents: candidate - 1 }, project({ ...fixed, saving_cents: candidate - 1 }, 2026)).funded_at_goal, false);
  const traditional = structuredClone(s); retire(traditional).mode = 'traditional'; assert.deepEqual(requirement(traditional), req);
  r.real_return_after_hundredths = -1000;
  assert.equal(requirement(s).lower.status, 'out_of_bounds');
});

test('B06/D21 month-start payment cannot be funded by month-end contribution; search boundary is explicit', () => {
  const base = prediction(fictionalSources('0')).plan;
  const payment = { ...base, first_month_fraction: 1, assets_cents: 0, start_payments: [{ offset_months: 0, cents: 10000 }] };
  // Public ledger uses negative saving flows for recurring month-start obligations.
  payment.saving_flows = [{ label: '虚构首月费用', from_month: payment.now_months, to_month: payment.now_months + 1, cents: -10000, nominal: false, essential: true, timing: 'start' }];
  assert.equal(solveBasicRequirement(n => ({ ...payment, saving_cents: n }), 0, 0).status, 'payment_constraint');
  const huge = { ...base, items: [ledgerItem('huge', 1e12)] };
  assert.equal(solveBasicRequirement(n => ({ ...huge, saving_cents: n }), 0, 0).status, 'search_not_found');
  assert.equal(BASIC_SEARCH_LIMIT_CENTS, 100000000);
});

test('B06a/D28/D34 total budget normalizes included rent and detail once, keeps schedules and essential labels', () => {
  const s = fictionalSources('1000000'), r = retire(s); r.rent_cents = '100000'; r.basic.retirement_costs = [scope('rent', 'included', '100000')];
  assert.equal(table(prediction(s).plan).spend[300], 400000);
  r.basic.retirement_costs[0] = scope('rent', 'extra');
  assert.equal(table(prediction(s).plan).spend[300], 500000);
  r.spend_items = [{ ...item('travel', 150000, false), start_age: 60, end_age: 61 }];
  r.basic.retirement_costs = [scope('rent', 'included', '100000'), scope('spend:travel', 'included', '150000')];
  const p = prediction(s).plan, t = table(p), idx = p.target_months - p.now_months;
  assert.equal(t.spend[idx], 400000); assert.equal(t.essential[idx], 250000);
  assert.equal(t.spend[idx + 12], 250000);
  r.basic.retirement_costs = [];
  assert.equal(buildBasicCapabilities(s).requirement.status, 'blocked');
  assert.ok(buildBasicCapabilities(s).requirement.missing.some(m => m.code === 'COST_SCOPE_UNKNOWN'));
});

test('B06/D31/D32 complete flexible budget and finite zero margin agree in deterministic and fixed-return simulation', async () => {
  const base = prediction(fictionalSources('0')).plan;
  const p = { ...base, now_months: 720, target_months: 720, horizon_months: 721, first_month_fraction: 1, assets_cents: 0, volatility_hundredths: 0, items: [ledgerItem('essential', 450000), ledgerItem('flex', 150000, false)], incomes: [ledgerIncome('annuity', 500000)] };
  const proj = project(p, 2026); assert.equal(proj.rows[0].essential_unfunded, 0); assert.equal(proj.rows[0].unfunded, 100000); assert.equal(outcome(p, proj).success, false);
  assert.equal((await monteCarlo(p, 8)).success_rate, 0);
  const zero = { ...p, items: [ledgerItem('essential', 450000), ledgerItem('flex', 50000, false)] }, z = project(zero, 2026), o = outcome(zero, z);
  assert.equal(o.success, true); assert.equal(o.at_horizon, 0); assert.equal((await monteCarlo(zero, 8)).success_rate, 1);
  assert.match(verdict(zero, z, o, 0, 'today', String).guidance, /终点无余量/);
});

test('B07 legacy stages/routes/worker do not alter basic requirements; no 35-year reference', () => {
  const s = fictionalSources('0'), baseline = requirement(s);
  retire(s).saving_phases = [{ id: 'old-zero', label: '旧零', from_age_months: 0, monthly_cents: 0 }, { id: 'old-negative', label: '旧负', from_age_months: 500, monthly_cents: -1000000 }];
  retire(s).route_id = 'technology'; profile(s).worker = 'female_worker';
  assert.deepEqual(requirement(s), baseline);
  const p = prediction(s); assert.deepEqual(checkpoints(p.plan, p.projection), []);
  assert.deepEqual(routeCompare(s.profile.value.saved, null, null, [], s.today), []);
});

function beijingSources(n) {
  const s = fictionalSources(n), p = profile(s), r = p.retire;
  Object.assign(p, { worker: 'male', region: 'beijing', paid_months: 200, account_balance_cents: '5000000', base_cents: '1500000', flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000 });
  r.core.hpf_monthly_cents = '0'; r.basic.retirement_income.mode = 'beijing'; r.basic.pension_contributions = { start_month: '2027-01', stop_month: '2050-06', base_cents: '1500000' };
  return s;
}

test('B04/B06a/D20/D35 Beijing contributions independent of signed saving, other income selected once, excluded definitions retained', () => {
  const pensions = [null, '-100000', '0', '100000'].map(n => buildBasicCapabilities(beijingSources(n)).pension);
  assert.ok(pensions.every(p => p.status === 'ready')); pensions.forEach(p => assert.deepEqual(p, pensions[0]));
  const s = beijingSources('0'), r = retire(s); r.income_items = [stream('other', 50000), stream('state', 200000)];
  r.basic.retirement_income.selected = [{ id: 'other', source_id: 'annuity', role: 'other' }];
  const c = prediction(s), idx = c.plan.pension_at(c.plan.now_months).unlock_age_months - c.plan.now_months;
  assert.equal(table(c.plan).income[idx], 50000);
  assert.ok(c.plan.pension_at(c.plan.now_months).monthly_cents > 0);
  r.basic.retirement_income.selected.push({ id: 'state', source_id: 'beijing_state_pension', role: 'state_pension' });
  assert.equal(buildBasicCapabilities(s).requirement.status, 'blocked');
  r.basic.retirement_income = { mode: 'manual', selected: [{ id: 'state', source_id: 'beijing_state_pension', role: 'state_pension' }, { id: 'other', source_id: 'annuity', role: 'other' }] };
  assert.equal(table(prediction(s).plan).income[idx], 250000);
  r.basic.retirement_income = { mode: 'excluded', selected: [] };
  assert.equal(table(prediction(s).plan).income[idx], 0); assert.equal(r.income_items.length, 2);
});

test('B11/B12 independent summary, temporary context, wishes require saved prediction; no mutation or cross-library response', async () => {
  const s = fictionalSources(), before = structuredClone(s);
  const summary = summaryRetire({ ...s, snapshotId: null, snapshotDate: null }, s.today);
  assert.equal(summary.kind, 'blocked'); assert.equal(summary.capabilities.requirement.status, 'ready'); assert.match(summary.main, /目标所需月投入/);
  const temporary = buildBasicCapabilities(s, '1000000'); assert.equal(temporary.prediction.value.source, 'temporary'); assert.deepEqual(s, before);
  const unknown = buildRetireCalc(s.profile.value.saved, null, null, [], s.today, s); assert.equal(isReady(unknown), false);
  const zero = fictionalSources('0'), calc = buildRetireCalc(zero.profile.value.saved, null, null, [], zero.today, zero); assert.equal(isReady(calc), true); assert.ok(impactOf(calc, []).base_offset === null || Number.isInteger(impactOf(calc, []).base_offset));
  const pending = []; const session = planningReadSession(() => new Promise(resolve => pending.push(resolve)));
  const old = session.load('fictional', s.modules); session.invalidate(); pending.shift()(s); assert.equal(await old, null);
  const wrong = session.load('new-library', s.modules); pending.shift()(s); assert.equal(await wrong, null);
  const wrongModules = session.load('fictional', { planning: true, wealth: true }); pending.shift()(s); assert.equal(await wrongModules, null);
  const current = session.load('fictional', s.modules); pending.shift()(s); assert.deepEqual(await current, s);
});

test('B01a/B10 real and simulated starts replace each other; raw unrelated snapshot is never added', () => {
  const s = fictionalSources('0'); s.modules.wealth = true;
  s.snapshot = ready({ id: 'fictional-snapshot', revision: 3, date: '2026-09-30', missing: [], entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: '12345' }] });
  assert.equal(buildBasicCapabilities(s).funds.value.available_cents, '10000000');
  retire(s).basic.start = { kind: 'live' }; retire(s).core.fund_rules = [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }];
  assert.equal(buildBasicCapabilities(s).funds.value.available_cents, '12345');
  s.modules.wealth = false; assert.equal(buildBasicCapabilities(s).funds.status, 'blocked');
  assert.ok(buildBasicCapabilities(s).funds.missing.some(m => m.code === 'WEALTH_DISABLED'));
});

test('D34 partial first month keeps included ordinary rent within total budget; rent ends once after house', () => {
  const s = fictionalSources('1000000'), r = retire(s); r.basic.start.date='2026-09-15'; r.rent_cents='100000';r.basic.retirement_costs=[scope('rent','included','100000')];
  const p=prediction(s).plan;assert.equal(table(p).spend[0],400000*15/30);
  r.life_events=[{id:'future-house',label:'虚构房',kind:'house',date:'2050-06',included:true,price_cents:'1000000',down_cents:'1000000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'0',rent_saved_cents:'100000',cycle_years:null,until_age:null,resale_cents:'0'}];
  const h=prediction(s).plan,idx=h.target_months-h.now_months;assert.equal(table(h).spend[idx],300000);assert.equal(table(h).spend[idx+1],300000);
});

test('D20 pension transfer interval stays fixed past early retirement and included contribution reference restores once', () => {
  const s=beijingSources('-100000'),r=retire(s);profile(s).personal_pension_annual_cents='1200000';r.core.personal_pension_balance_confirmed=true;
  r.target_age=50;r.basic.contribution_costs=[scope('personal_pension','included','100000')];r.basic.retirement_costs=[scope('personal_pension','extra')];
  const p=prediction(s).plan,savings=savingsOf(p),t=table(p),start=(2027*12)-(1990*12+5)-p.now_months,goal=p.target_months-p.now_months;
  assert.equal(savings[start],-100000);assert.equal(t.spend[goal],500000);
  r.basic.contribution.monthly_cents='100000';const p2=prediction(s).plan;assert.deepEqual(p2.pension_at(p2.now_months),p.pension_at(p.now_months));
  r.basic.retirement_costs=[scope('personal_pension','excluded')];assert.equal(buildBasicCapabilities(s).requirement.status,'blocked');
});

test('basic backwards requirement pass equals full independent required() at every month before/at/after pool unlock', () => {
  const p={...prediction(fictionalSources('100000')).plan,first_month_fraction:0.5,r_after_hundredths:400, horizon_months:500,pension_at:()=>({monthly_cents:200000,lump_cents:2000000,unlock_age_months:470}),spends:[{offset_months:10,cents:123456}],saving_flows:[{label:'付款',from_month:445,to_month:455,cents:-12345,nominal:true,essential:true,timing:'start'}]};
  const result=requiredAt(p);for(let t=0;t<result.length;t++)assert.ok(Math.abs(result[t]-required(p,p.now_months+t))<1e-7,`month ${t}: ${result[t]} vs ${required(p,p.now_months+t)}`);
});

test('B06a/D35 exact Beijing 2000 plus selected annuity 500 equals 2500; no hand-filled pension added', () => {
  const s=beijingSources('0'),p=profile(s),r=p.retire;
  p.paid_months=240;p.account_balance_cents='0';p.base_cents='1000000';p.past_index_hundredths=100;p.assumptions.wage_growth_hundredths=0;p.overrides={...noOverrides,avg_wage_cents:'1000000'};
  r.basic.pension_contributions={start_month:'2027-01',stop_month:'2027-01',base_cents:'0'};
  r.income_items=[stream('annuity',50000),stream('state-manual',200000)];r.basic.retirement_income.selected=[{id:'annuity',source_id:'annuity',role:'other'}];
  const value=prediction(s),pen=value.plan.pension_at(value.plan.now_months),t=table(value.plan);assert.equal(pen.monthly_cents,200000);assert.equal(t.income[pen.unlock_age_months-value.plan.now_months]+pen.monthly_cents,250000);
  const wholeYear=value.projection.rows.find(row=>row.start_month>=pen.unlock_age_months&&row.start_month+12<=value.plan.horizon_months);assert.equal(wholeYear.income,3000000);
});

test('B06/B12 finite no-margin prediction and source notes use confirmed simulation; temporary cannot enter wishes', () => {
  const s=fictionalSources('0'),r=retire(s);r.basic.start.available_cents='0';r.spend_cents='500000';r.income_items=[stream('cover',500000)];r.basic.retirement_income={mode:'manual',selected:[{id:'cover',source_id:'cover',role:'other'}]};
  assert.equal(prediction(s).terminal,'no_margin');const summary=summaryRetire({...s,snapshotId:null,snapshotDate:null},s.today);assert.equal(summary.kind,'ready');assert.equal(summary.headline.main,'有限期间预算已覆盖');
  const calc=summary.calc;calc.capabilities=buildBasicCapabilities(s,'100000');assert.equal(isReady(calc),false);assert.throws(()=>impactOf(calc,[]),/已保存/);
});

test('B11 missing target/budget and stale library block independently without turning unknown into zero', () => {
  const s=fictionalSources();retire(s).target_age=null;retire(s).spend_cents=null;
  const c=buildBasicCapabilities(s);assert.equal(c.funds.status,'ready');assert.equal(c.requirement.status,'blocked');assert.ok(c.requirement.missing.some(m=>m.code==='TARGET_UNKNOWN'));assert.ok(c.requirement.missing.some(m=>m.code==='BUDGET_UNKNOWN'));
  s.generation='new-library';assert.equal(buildBasicCapabilities(s).funds.status,'blocked');assert.ok(buildBasicCapabilities(s).requirement.missing.some(m=>m.code==='SOURCE_STALE'));
});

test('B10 restricted pools cannot be counted twice as starting cash and pension unlock; explicit scope requires confirmed live sources', () => {
  const s=beijingSources('0'),r=retire(s);s.modules.wealth=true;r.basic.start={kind:'live'};r.core.personal_pension_account_id='pp';r.core.personal_pension_balance_confirmed=true;
  s.snapshot=ready({id:'snapshot',revision:1,date:'2026-09-30',missing:[],entries:[{account_id:'cash',counted:true,side:'asset',kind:'cash',amount_cents:'20000000'},{account_id:'pp',counted:true,side:'asset',kind:'other_asset',amount_cents:'5000000'},{account_id:'hpf',counted:true,side:'asset',kind:'housing_fund',amount_cents:'7000000'}]});
  r.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000},{account_id:'pp',availability:'restricted',share_hundredths:10000},{account_id:'hpf',availability:'restricted',share_hundredths:10000}];
  const c=buildBasicCapabilities(s);assert.equal(c.requirement.status,'ready');assert.equal(c.funds.value.available_cents,'20000000');assert.equal(c.funds.value.restricted_cents,'12000000');
  r.core.fund_rules[1].availability='available';assert.ok(buildBasicCapabilities(s).requirement.missing.some(m=>m.code==='POOL_UNCONFIRMED'));
  r.core.fund_rules[1].availability='restricted';r.core.fund_rules[2].availability='available';assert.equal(buildBasicCapabilities(s).prediction.status,'blocked');
});

test('B10/D28 actual absorbed payment and remaining loan continue once, even original price/down definition changed', () => {
  const s=fictionalSources('1000000'),r=retire(s);s.modules.wealth=true;r.basic.start={kind:'live'};
  s.snapshot=ready({id:'snapshot',revision:2,date:'2026-09-30',missing:[],entries:[{account_id:'cash',counted:true,side:'asset',kind:'cash',amount_cents:'20000000'},{account_id:'loan',counted:true,side:'liability',kind:'loan',amount_cents:'1200000'}]});
  r.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000}];
  r.life_events=[{id:'e',label:'虚构已购物品',kind:'other',date:'2026-01',included:false,price_cents:'1000000',down_cents:'1000000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'10000',rent_saved_cents:'0',cycle_years:null,until_age:null,resale_cents:'0'}];
  r.core.occurrences=[{id:'o',event_id:'e',status:'occurred',actual_date:'2026-01-01',payments_complete:true,payments:[{id:'payment',date:'2026-01-01',amount_cents:'1000000',account_id:'cash',absorbed_snapshot_id:'snapshot',absorbed_revision:2,source_kind:null,source_id:null}],loan:{account_id:'loan',as_of:'2026-09-30',principal_cents:'1200000',remaining_months:12}}];
  r.basic.contribution_costs=[scope('event:e:loan','included','100000'),scope('event:e:holding','extra')];r.basic.retirement_costs=[scope('event:e:loan','extra'),scope('event:e:holding','extra')];
  const p=prediction(s).plan;assert.equal(p.assets_cents,20000000);assert.equal(oneOffsOf(p)[0],0);assert.equal(p.loans.length,1);assert.equal(p.loans[0].principal_cents,1200000);assert.equal(startPaymentsOf(p)[1],110000);assert.equal(savingsOf(p)[1],990000);
  r.basic.retirement_costs[0]=scope('event:e:loan','excluded');assert.equal(buildBasicCapabilities(s).requirement.status,'blocked');
});
