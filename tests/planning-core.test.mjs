import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCore, normalizeFunds, occurrenceMissing, eventSource } from '../src/plan-core.ts';
import { buildRetireCalc } from '../src/plan-retire-calc.ts';
import { computeReview, defaultRetire } from '../src/plan.ts';
import { savingsOf, project, nominalFactor, coastAt, glide } from '../src/plan-ledger.ts';
import { eventParts, applyEvents, offsetOf } from '../src/plan-events.ts';
import { project as pensionProject } from '../src/plan-pension.ts';
import { beijing, noOverrides } from '../src/plan-params.ts';
import { requiredSaving, monteCarlo } from '../src/plan-risk.ts';
const B = '2026-10-31';
const entry = (id, side, kind, amount) => ({ account_id: id, side, kind, amount_cents: String(amount), counted: true, state: 'entered' });
const snap = (entries, date = B) => ({ id: 'snapshot', revision: 1, date, entries, missing: [] });
const core = (...rules) => ({ ...emptyCore(B), hpf_monthly_cents: '0', fund_rules: rules.map(([account_id, availability]) => ({ account_id, availability, share_hundredths: 10000 })) });
const event = (over = {}) => ({ id: 'house', label: '虚构住宅', kind: 'house', date: '2026-09', included: true, price_cents: '40000000', down_cents: '30000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 30, holding_cents: '10000', rent_saved_cents: '0', cycle_years: null, until_age: null, resale_cents: '0', ...over });
const occurrence = (over = {}) => ({ id: 'occ', event_id: 'house', status: 'occurred', actual_date: '2026-09-01', payments_complete: true, payments: [{ id: 'payment', date: '2026-09-01', amount_cents: '30000000', account_id: 'cash', absorbed_snapshot_id: 'snapshot', absorbed_revision: 1, source_kind: null, source_id: null }], loan: { account_id: 'loan', as_of: B, principal_cents: '10000000', remaining_months: 50 }, ...over });
const profile = (c, over = {}) => ({ revision: 1, updated_at: B, profile: { birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 300, account_balance_cents: '0', base_cents: '0', past_index_hundredths: null, flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 0, assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 }, overrides: noOverrides, retire: { ...defaultRetire, spend_cents: '100000', target_age: 65, saving_phases: [{ id: 'phase', label: '明确净投入', from_age_months: 0, monthly_cents: 500000 }], core: c, ...over } } });
const review = { stats: { median_monthly_saving_cents: '6000000', median_monthly_spend_cents: '-4000000' }, intervals: [] };
const calc = (p, s) => buildRetireCalc(p, s, review, [], B);
const ready = c => { assert.deepEqual(c.missing, []); assert.ok(c.plan); return c; };
const base = (over = {}) => ({ now_months: 420, horizon_months: 424, search_cap_months: 424, target_months: 423, mode: 'fire', assets_cents: 10000000, saving_cents: 0, saving_growth_hundredths: 0, r_before_hundredths: 0, r_after_hundredths: 0, inflation_hundredths: 0, volatility_hundredths: 0, items: [], incomes: [], spends: [], pension_at: () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 1000 }), ...over });

test('R01/R02: net asset facts survive no income; income rows never establish complete coverage', () => {
  const points = [{ snapshot_id: 'a', date: '2026-09-01', complete: true, compared_to: null, net_cents: '10000000', scope_changed: false, change_cents: null, hpf_change_cents: null }, { snapshot_id: 'b', date: '2026-10-01', complete: true, compared_to: '2026-09-01', net_cents: '16000000', scope_changed: false, change_cents: '6000000', hpf_change_cents: '0' }];
  const noIncome = computeReview(points, [], new Set(), 'fake');
  assert.equal(noIncome.intervals[0].delta_nw_cents, '6000000');
  const recorded = computeReview(points, [{ id: 'income', revision: 1, fields: { date: '2026-09-20', net_cents: '2000000', hpf_cents: '0', notes: '虚构：资产增长其中5万元估值变化，未实施完整归因' } }], new Set(), 'fake');
  assert.equal(recorded.intervals[0].income_cents, '2000000');
  assert.equal(recorded.intervals[0].income_possibly_missing, true);
  assert.equal(recorded.stats.mean_monthly_change_cents, noIncome.stats.mean_monthly_change_cents);
  assert.notEqual(noIncome.stats.mean_monthly_change_cents, null);
  const p = profile(core(['cash', 'available']), { saving_phases: [] });
  assert.match(calc(p, snap([entry('cash','asset','cash',16000000)])).missing.join(' '), /未来净投入待确认/);
  assert.equal(calc(p, snap([entry('cash','asset','cash',16000000)])).derivedSpend, null);
});

test('D01/D02: restricted money cannot pay, and the emergency line is not a second expense', () => {
  const funds = normalizeFunds(snap([entry('cash','asset','cash',10000000),entry('restricted','asset','other_asset',90000000)]),core(['cash','available'],['restricted','restricted']));
  assert.equal(funds.available, 10000000); assert.equal(funds.restricted, 90000000);
  assert.equal(project(base({ spends: [{ offset_months: 0, cents: 30000000 }] }), 2026).assets[0], -20000000);
  const a = project(base({ spends: [{ offset_months: 0, cents: 8000000 }] }), 2026).assets[0];
  assert.equal(a, 2000000); assert.equal(Math.max(0,3000000-a),1000000);
});

test('D03/D04/D05: absorbed upfront money is retained, debt pays once and holding costs outlive loan', () => {
  const c = core(['cash','available']); c.occurrences = [occurrence()];
  c.costs = [{ phase_id: 'phase', source_id: eventSource('house','loan'), included: true, reference_cents: '200000' }, { phase_id: 'phase', source_id: eventSource('house','holding'), included: false, reference_cents: '0' }];
  const r = ready(calc(profile(c,{life_events:[event()]}),snap([entry('cash','asset','cash',70000000),entry('loan','liability','loan',10000000)])));
  assert.equal(r.proj.assets[0],70000000); assert.equal(r.proj.debt[0],10000000);
  assert.equal(savingsOf(r.plan0)[1],490000,'hypothetical comparisons retain factual debt and maintenance');
  assert.equal(savingsOf(r.plan)[1],490000); assert.equal(r.proj.debt[2],9800000);
  assert.equal(savingsOf(r.plan)[51],690000,'holding fee continues after loan ends');
  c.occurrences[0].loan = { account_id: 'loan', as_of: B, principal_cents:'3600000',remaining_months:12 }; c.costs[0].reference_cents='300000';
  const d = ready(calc(profile(c,{life_events:[event({holding_cents:'0'})]}),snap([entry('cash','asset','cash',70000000),entry('loan','liability','loan',3600000)])));
  assert.equal(savingsOf(d.plan)[1],500000); assert.equal(savingsOf(d.plan)[13],800000);
  assert.equal(d.proj.debt[13],0); assert.equal(d.proj.assets[0],70000000);
});

test('D06: split payments only deduct the part after B; partial or stale absorption blocks conclusions', () => {
  const c = core(['cash','available']); const o=occurrence({loan:null}); c.occurrences=[o];
  o.payments.push({ ...o.payments[0], id:'second', date:'2026-11-01', amount_cents:'10000000', absorbed_snapshot_id:null, absorbed_revision:null });
  const e=event({price_cents:'30000000',down_cents:'30000000',holding_cents:'0'}),s=snap([entry('cash','asset','cash',70000000)]);
  const r=ready(calc(profile(c,{life_events:[e],saving_phases:[{id:'phase',label:'明确零',from_age_months:0,monthly_cents:0}]}),s));
  assert.equal(r.proj.assets[0],70000000); assert.equal(r.proj.assets[1],60000000); assert.equal(r.proj.assets[2],60000000);
  o.payments_complete=false; assert.match(calc(profile(c,{life_events:[e]}),s).missing.join(' '),/部分付款/);
  o.payments_complete=true;o.payments[0].absorbed_revision=2;assert.match(calc(profile(c,{life_events:[e]}),s).missing.join(' '),/吸收待核对/);
  o.payments[0].account_id='restricted';assert.match(calc(profile(c,{life_events:[e]}),s).missing.join(' '),/来源范围/);
});

test('D09: overdue is unresolved, never silently shifted to current month', () => {
  assert.equal(offsetOf('2026-09',B),-1);
  const p=profile(core(['cash','available']),{life_events:[event()]});
  assert.match(calc(p,snap([entry('cash','asset','cash',70000000)])).missing.join(' '),/日期已过，待核对/);
  assert.deepEqual(eventParts(base(),{...event(),price_cents:40000000,down_cents:30000000,holding_cents:10000},-1).spends,[]);
});

test('D10/D15: B and T convert nominal balance and payments exactly once', () => {
  const c=core(['cash','available']);c.monetary_basis_date='2025-10-31';
  const p=profile(c);p.profile.assumptions.inflation_hundredths=1000;
  const r=ready(calc(p,snap([entry('cash','asset','cash',11000000)])));
  assert.ok(Math.abs(r.assets*r.plan.basis_factor-11000000)<0.01);
  const x=eventParts(r.plan,{...event({date:'2026-12'}),price_cents:20000000,down_cents:10000000,extra_cents:0,holding_cents:0},2);
  assert.ok(Math.abs(x.principal_cents-10000000*nominalFactor(r.plan,r.now+2))<0.01);
  assert.equal(x.spends[0].cents,10000000);
});

test('D11: end-month saving cannot repair a start-month affordability failure, including inverse and risk paths', async () => {
  const p=base({saving_cents:30000000,spends:[{offset_months:0,cents:30000000}]});
  const proj=project(p,2026);assert.equal(proj.assets[0],-20000000);assert.equal(proj.failure_month,420);
  assert.equal(requiredSaving(p,2026,423),null);
  assert.equal((await monteCarlo(p,10,{seed:1})).success_rate,0);
});

test('first remaining days and explicit zero preserve start-of-month order', () => {
  const c=core(['cash','available']);c.monetary_basis_date='2026-10-15';
  const r=ready(calc(profile(c),snap([entry('cash','asset','cash',10000000)],'2026-10-15')));
  assert.equal(r.plan.first_month_fraction,16/31);assert.ok(Math.abs(savingsOf(r.plan)[0]-500000*16/31)<0.001);
  const p=profile(c,{saving_phases:[{id:'zero',label:'明确零',from_age_months:0,monthly_cents:0}]});
  assert.equal(ready(calc(p,snap([entry('cash','asset','cash',10000000)],'2026-10-15'))).saving,0);
});

test('D08/D16: PP moves cash once; payroll HPF adds only restricted funds, and pools never overlap', () => {
  const c=core(['cash','available'],['pp','restricted'],['hpf','restricted']);c.personal_pension_account_id='pp';c.personal_pension_balance_confirmed=true;c.hpf_monthly_cents='300000';c.costs=[{phase_id:'phase',source_id:'personal_pension',included:false,reference_cents:'0'}];
  const p=profile(c);p.profile.personal_pension_annual_cents='1200000';
  const r=ready(calc(p,snap([entry('cash','asset','cash',10000000),entry('pp','asset','other_asset',5000000),entry('hpf','asset','housing_fund',0)])));
  assert.equal(r.assets,10000000);assert.equal(savingsOf(r.plan)[1],400000);
  c.fund_rules.find(f=>f.account_id==='hpf').share_hundredths=5000;
  assert.equal(normalizeFunds(snap([entry('hpf','asset','housing_fund',2000000)]),c).housingFund,1000000);
  c.fund_rules.find(f=>f.account_id==='hpf').share_hundredths=10000;
  const funds={hpf_balance_cents:'0',hpf_monthly_cents:'300000',personal_pension_balance_cents:'5000000',first_month_fraction:0};
  const pr=pensionProject(p.profile,{...beijing,hpf_rate_hundredths:0},B,r.now+2,funds);
  assert.equal(pr.hpf_at_start_cents,300000);assert.equal(pr.personal_pension_at_start_cents,5100000);
  p.profile.personal_pension_annual_cents='0';p.profile.retire.core.costs=[];
  assert.equal(savingsOf(ready(calc(p,snap([entry('cash','asset','cash',10000000),entry('pp','asset','other_asset',5000000),entry('hpf','asset','housing_fund',0)]))).plan)[1],500000);
  c.personal_pension_account_id='cash';assert.match(calc(p,snap([entry('cash','asset','cash',10000000)])).missing.join(' '),/单独确认的受限/);
});

test('duplicate debt continuation, unsupported reference changes, and hypothetical included costs stay incomplete', () => {
  const c=core(['cash','available']);c.occurrences=[occurrence(),{...occurrence(),id:'second',event_id:'second'}];
  assert.match(occurrenceMissing(snap([entry('cash','asset','cash',70000000),entry('loan','liability','loan',10000000)]),c,[event(),event({id:'second'})],B).join(' '),/重复接续/);
  const p=profile(core(['cash','available']),{life_events:[event({date:'2030-01'})]});p.profile.retire.core.costs=[{phase_id:'phase',source_id:'event:house:loan',included:true,reference_cents:'300000'}];
  assert.match(calc(p,snap([entry('cash','asset','cash',70000000)])).missing.join(' '),/未发生费用/);
  p.reference_issues=['来源已变化'];assert.match(calc(p,snap([entry('cash','asset','cash',70000000)])).missing.join(' '),/来源已变化/);
});


test('included costs normalize before unemployment weighting; occurred rent savings are not credited again', () => {
  const c=core(['cash','available']);c.occurrences=[occurrence()];c.costs=[{phase_id:'phase',source_id:'event:house:loan',included:true,reference_cents:'200000'},{phase_id:'phase',source_id:'event:house:holding',included:false,reference_cents:'0'}];
  const p=profile(c,{life_events:[event({rent_saved_cents:'100000'})],gap_share_hundredths:2000});
  const r=ready(calc(p,snap([entry('cash','asset','cash',70000000),entry('loan','liability','loan',10000000)])));
  assert.equal(savingsOf(r.plan)[1],330000); // .8*(5000+2000)-.2*1000-2000-100, cents.
});

test('a PP balance without confirmation stays unknown rather than default zero', () => {
  const c=core(['cash','available']);c.costs=[{phase_id:'phase',source_id:'personal_pension',included:false,reference_cents:'0'}];
  const p=profile(c);p.profile.personal_pension_annual_cents='1200000';
  assert.match(calc(p,snap([entry('cash','asset','cash',10000000)])).missing.join(' '),/已有个人养老金余额待核对/);
  p.profile.personal_pension_annual_cents='0';c.personal_pension_account_id='pp';c.fund_rules.push({account_id:'pp',availability:'restricted',share_hundredths:10000});
  assert.match(calc(p,snap([entry('cash','asset','cash',10000000),entry('pp','asset','other_asset',5000000)])).missing.join(' '),/已有个人养老金余额待核对/);
});


test('monthly plan payments also precede net contribution and retirement income across deterministic and risk paths', async () => {
  const from=420,flow={label:'月供',from_month:from,to_month:from+2,cents:-300000,nominal:false,essential:true,timing:'start'};
  const p=base({assets_cents:0,saving_cents:800000,saving_flows:[flow],spend_flows:[{...flow,cents:300000}]});
  const r=project(p,2026);assert.equal(r.failure_month,420);assert.equal(r.assets[1],500000);
  assert.equal(requiredSaving(p,2026,423),null);assert.equal((await monteCarlo(p,10,{seed:2})).success_rate,0);
  const retired={...p,mode:'traditional',target_months:420,saving_cents:0,pension_at:()=>({monthly_cents:300000,lump_cents:0,unlock_age_months:420})};
  assert.equal(project(retired,2026).failure_month,420,'same month pension cannot fund an earlier payment');
});


test('start-payment ordering preserves cash conservation even when later income repays its temporary deficit', () => {
  const sf={label:'月供',from_month:420,to_month:422,cents:-300000,nominal:false,essential:true,timing:'start'};
  const p=base({assets_cents:100000,saving_cents:800000,saving_flows:[sf],spend_flows:[{...sf,cents:300000}],mode:'traditional',target_months:420,pension_at:()=>({monthly_cents:300000,lump_cents:0,unlock_age_months:420})});
  const result=project(p,2026);assert.equal(result.failure_month,420);
  for (const r of result.rows) assert.ok(Math.abs(r.end-(r.start+r.contribution+r.unlock+r.income-r.spend+r.unfunded-r.oneoff))<0.01);
});


test('D15: zero nominal return cash does not grow when B/T differ, including the first partial month', () => {
  for (const fraction of [0,16/31,1]) {
    const p=base({first_month_fraction:fraction,basis_factor:1.25,inflation_hundredths:2500,r_before_hundredths:-2000,r_after_hundredths:-2000,assets_cents:8000000});
    const r=project(p,2026);
    for(let t=0;t<r.assets.length;t++) assert.ok(Math.abs(r.assets[t]*nominalFactor(p,p.now_months+t)-10000000)<0.01);
  }
});


test('Coast and glide checkpoints retain actual payments, one-offs and the first partial period', () => {
  const f={label:'月供',from_month:420,to_month:423,cents:-300000,nominal:false,essential:true,timing:'start'};
  const p=base({first_month_fraction:.5,saving_cents:800000,r_before_hundredths:1200,mode:'traditional',items:[{id:'living',label:'生活',monthly_cents:100000,start_age:null,end_age:null,inflation_hundredths:null,essential:true}],saving_flows:[f],spend_flows:[{...f,cents:300000}],spends:[{offset_months:1,cents:200000}]});
  const need=glide(p,project(p,2026))[0],r=project({...p,assets_cents:need},2026);
  assert.equal(r.failure_month,null);assert.ok(r.assets[3]>=100000-.01);
  const coast=coastAt(p,p.now_months),c=project({...p,assets_cents:coast,saving_cents:0},2026);
  assert.equal(c.failure_month,null);assert.ok(c.assets[3]>=100000-.01);assert.ok(coast>900000);
});


test('read-time factual payment duplication blocks every complete projection until corrected', () => {
  const p = profile(core(['cash', 'available']));
  const s = snap([entry('cash', 'asset', 'cash', 70000000)]);
  ready(calc(p, s));
  p.reference_issues = ['同一实际付款被重复关联，请核对物品、已购愿望或关联支出'];
  const blocked = calc(p, s);
  assert.match(blocked.missing.join(' '), /重复关联/);
  for (const key of ['plan', 'plan0', 'proj', 'out']) assert.equal(blocked[key], undefined, key);
  assert.deepEqual(blocked.events, []);
  p.reference_issues = [];
  ready(calc(p, s));
});
