import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBasicCapabilities, solveBasicRequirement, BASIC_SEARCH_LIMIT_CENTS } from '../src/plan-basic.ts';
import { buildRetireCalc } from '../src/plan-retire-calc.ts';
import { fictionalFutureIncome } from './helpers/simplified-planning-fixtures.mjs';
import { project, outcome, table, savingsOf, startPaymentsOf, oneOffsOf, required, requiredAt } from '../src/plan-ledger.ts';
import { monteCarlo } from '../src/plan-risk.ts';
import { verdict } from '../src/plan-view.ts';
import { summaryRetire } from '../src/plan-summary.ts';
import { isReady, impactOf } from '../src/plan-wishes.ts';
import { planningReadSession } from '../src/planning-service.ts';
import { fictionalSources } from './helpers/planning-fixtures.mjs';
export { fictionalSources };
const ready = value => ({ status: 'ready', value });
const error = { status: 'error', value: { code: 'FICTIONAL', message: '虚构独立来源故障' } };
const profile = s => s.profile.value.saved.profile;
const retire = s => profile(s).retire;
const prediction = s => { const c = buildBasicCapabilities(s); assert.equal(c.prediction.status, 'ready', JSON.stringify(c.prediction)); return c.prediction.value; };
const requirement = s => { const c = buildBasicCapabilities(s); assert.equal(c.requirement.status, 'ready', JSON.stringify(c.requirement)); return c.requirement.value; };
const stream = (id, amount) => ({ id, label: id, monthly_cents: String(amount), start_age: 0, end_age: null, indexed: true });
const item = (id, amount, essential = true) => ({ id, label: id, monthly_cents: String(amount), start_month: null, end_month: null, time_unconfirmed: false, inflation_hundredths: null, essential });
const ledgerItem = (id, amount, essential = true) => ({ ...item(id, amount, essential), monthly_cents: amount, start_age:null,end_age:null });
const ledgerIncome = (id, amount) => ({ ...stream(id, amount), monthly_cents: amount });
const scope = (id, treatment, reference = null) => ({ source_id: id, treatment, reference_cents: reference });

test('B01/B01a/B02/B03/D21/D29/D33 excluded optional income and failed history do not block simulated fixed-target requirements', () => {
  const s = fictionalSources(), before = structuredClone(s), c = buildBasicCapabilities(s);
  assert.equal(c.funds.value.available_cents, '10000000');
  assert.equal(c.pension.value.included, false);
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
  r.spend_items = [{ ...item('travel', 150000, false), start_month: '2050-06', end_month: '2051-05' }];
  r.basic.retirement_costs = [scope('rent', 'included', '100000'), scope('spend:travel', 'included', '150000')];
  const p = prediction(s).plan, t = table(p), idx = p.target_months - p.now_months;
  assert.equal(t.spend[idx], 400000); assert.equal(t.essential[idx], 250000);
  assert.equal(t.spend[idx + 12], 250000);
  r.basic.retirement_costs = [];
  assert.equal(buildBasicCapabilities(s).requirement.status, 'ready');
  assert.ok(buildBasicCapabilities(s).annotations.some(m => m.reason_code === 'COST_ASSUMED_EXTRA'));
  assert.equal(table(prediction(s).plan).spend[idx], 650000);
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
  r.life_events=[{id:'future-house',label:'虚构房',kind:'house',date:'2050-06',included:true,price_cents:'1000000',down_cents:'1000000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'0',rent_saved_cents:'100000',cycle_years:null,until_month:null,time_unconfirmed:false,resale_cents:'0'}];
  const h=prediction(s).plan,idx=h.target_months-h.now_months;assert.equal(table(h).spend[idx],300000);assert.equal(table(h).spend[idx+1],300000);
});

test('basic backwards requirement pass equals full independent required() at every month before/at/after pool unlock', () => {
  const p={...prediction(fictionalSources('100000')).plan,first_month_fraction:0.5,r_after_hundredths:400, horizon_months:500,pension_at:()=>({monthly_cents:200000,lump_cents:2000000,unlock_age_months:470}),spends:[{offset_months:10,cents:123456}],saving_flows:[{label:'付款',from_month:445,to_month:455,cents:-12345,nominal:true,essential:true,timing:'start'}]};
  const result=requiredAt(p);for(let t=0;t<result.length;t++)assert.ok(Math.abs(result[t]-required(p,p.now_months+t))<1e-7,`month ${t}: ${result[t]} vs ${required(p,p.now_months+t)}`);
});

test('B06/B12 finite no-margin prediction and source notes use confirmed simulation; temporary cannot enter wishes', () => {
  const s=fictionalSources('0'),r=retire(s);r.basic.start.available_cents='0';r.spend_cents='500000';r.simplified.income_mode='manual';r.simplified.future_incomes=[fictionalFutureIncome({id:'cover',monthly_cents:'500000',start_month:'2050-06',growth:'constant_purchasing_power'})];
  assert.equal(prediction(s).terminal,'no_margin');const summary=summaryRetire({...s,snapshotId:null,snapshotDate:null},s.today);assert.equal(summary.kind,'ready');assert.equal(summary.headline.main,'有限期间预算已覆盖');
  const calc=summary.calc;calc.capabilities=buildBasicCapabilities(s,'100000');assert.equal(isReady(calc),false);assert.throws(()=>impactOf(calc,[]),/已保存/);
});

test('B11 missing target/budget and stale library block independently without turning unknown into zero', () => {
  const s=fictionalSources();retire(s).simplified.time.target_month=null;retire(s).spend_cents=null;
  const c=buildBasicCapabilities(s);assert.equal(c.funds.status,'ready');assert.equal(c.requirement.status,'blocked');assert.ok(c.requirement.missing.some(m=>m.code==='TIME_UNCONFIRMED'));assert.ok(c.requirement.missing.some(m=>m.code==='BUDGET_UNKNOWN'));
  s.generation='new-library';assert.equal(buildBasicCapabilities(s).funds.status,'blocked');assert.ok(buildBasicCapabilities(s).requirement.missing.some(m=>m.code==='SOURCE_STALE'));
});

test('B10/D28 actual absorbed payment and remaining loan continue once, even original price/down definition changed', () => {
  const s=fictionalSources('1000000'),r=retire(s);s.modules.wealth=true;r.basic.start={kind:'live'};
  s.snapshot=ready({id:'snapshot',revision:2,date:'2026-09-30',missing:[],entries:[{account_id:'cash',counted:true,side:'asset',kind:'cash',amount_cents:'20000000'},{account_id:'loan',counted:true,side:'liability',kind:'loan',amount_cents:'1200000'}]});
  r.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000}];
  r.life_events=[{id:'e',label:'虚构已购物品',kind:'other',date:'2026-01',included:false,price_cents:'1000000',down_cents:'1000000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'10000',rent_saved_cents:'0',cycle_years:null,until_month:null,time_unconfirmed:false,resale_cents:'0'}];
  r.core.occurrences=[{id:'o',event_id:'e',status:'occurred',actual_date:'2026-01-01',payments_complete:true,payments:[{id:'payment',date:'2026-01-01',amount_cents:'1000000',account_id:'cash',absorbed_snapshot_id:'snapshot',absorbed_revision:2,source_kind:null,source_id:null}],loan:{account_id:'loan',as_of:'2026-09-30',principal_cents:'1200000',remaining_months:12}}];
  r.basic.contribution_costs=[scope('event:e:loan','included','100000'),scope('event:e:holding','extra')];r.basic.retirement_costs=[scope('event:e:loan','extra'),scope('event:e:holding','extra')];
  const p=prediction(s).plan;assert.equal(p.assets_cents,20000000);assert.equal(oneOffsOf(p)[0],0);assert.equal(p.loans.length,1);assert.equal(p.loans[0].principal_cents,1200000);assert.equal(startPaymentsOf(p)[1],110000);assert.equal(savingsOf(p)[1],990000);
  r.basic.retirement_costs[0]=scope('event:e:loan','excluded');assert.equal(buildBasicCapabilities(s).requirement.status,'blocked');
});
