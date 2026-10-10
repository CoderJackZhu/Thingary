import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBasicCapabilities, prepareBasicPlan } from '../src/plan-basic.ts';
import { draftOf } from '../src/planning-basic-forms.ts';
import { eventParts, offsetOf } from '../src/plan-events.ts';
import { toEvent, buildRetireCalc } from '../src/plan-retire-calc.ts';
import { table, oneOffsOf, startPaymentsOf, project, debtSeries, nominalFactor, savingsOf } from '../src/plan-ledger.ts';
import { annotationSummary } from '../src/plan-annotations.ts';
import { canRetractOccurrence, retractOccurrence } from '../src/plan-occurrence-actions.ts';
import { summaryRetire } from '../src/plan-summary.ts';
import { impactOf } from '../src/plan-wishes.ts';

// Exported by a real temporary Store: demo_finance::import + import_plan, 2026-10-10.
const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/planning-basic/nonblocking-demo.json', import.meta.url)));
const profile = s => s.profile.value.saved.profile;
const car = s => profile(s).retire.life_events[0];
function fixture() {
  const s = structuredClone(raw);
  // Only the user's Q3 confirmation is derived; all source balances, debt and event data are retained.
  profile(s).retire.core.fund_rules = draftOf(s.profile.value.saved, s.snapshot.value, s.today).funds;
  return s;
}
const cash = s => s.snapshot.value.entries.find(e => e.kind === 'cash').account_id;
const debt = s => s.snapshot.value.entries.find(e => e.counted && e.side === 'liability');
const blank = s => ({ id: 'fictional-occurrence', event_id: car(s).id, status: 'occurred', actual_date: s.today, payments_complete: false, loan: null, payments: [{ id: 'fictional-payment', date: s.today, amount_cents: null, account_id: null, absorbed_snapshot_id: null, absorbed_revision: null, source_kind: null, source_id: null }] });
function occurred(s) { const o = blank(s); profile(s).retire.core.occurrences = [o]; return o; }
function calc(s) {
  const before = JSON.stringify(s), c = buildBasicCapabilities(s);
  assert.equal(c.requirement.status, 'ready', JSON.stringify(c.requirement));
  assert.equal(c.prediction.status, 'ready', JSON.stringify(c.prediction));
  assert.equal(JSON.stringify(s), before, 'calculation must not persist assumptions or replace nulls');
  assert.deepEqual(c.prediction.value.plan.annotations, c.annotations);
  return c;
}
const codes = c => [...new Set(c.annotations.map(a => a.reason_code))].sort();
const parts = (s, c) => eventParts(c.prediction.value.plan, toEvent(car(s)), offsetOf(car(s).date, s.snapshot.value.date));
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`);

test('raw same-batch demo is ready; removing Q3 declarations preserves the hard blocker; cash/debt definition stays unchanged', () => {
  assert.equal(buildBasicCapabilities(raw).requirement.status, 'ready');
  const unconfirmed = structuredClone(raw); profile(unconfirmed).retire.core.fund_rules = [];
  const c = buildBasicCapabilities(unconfirmed);
  assert.equal(c.requirement.status, 'blocked');
  assert.ok(c.requirement.missing.some(m => m.code === 'FUNDS_UNCONFIRMED'));
  const s = fixture(), v = calc(s);
  assert.equal(car(s).date, '2028-04');
  assert.equal(profile(s).personal_pension_annual_cents, '1200000');
  assert.equal(v.funds.value.available_cents, '10000000');
  assert.equal(v.funds.value.debt_cents, '500000');
  assert.equal(v.funds.value.restricted_cents, '25500000');
  assert.equal(v.annotations.filter(a => a.reason_code === 'DEBT_UNLINKED').length, 1);
});

test('complete future unoccurred car retains April 2028 schedule, payment/loan/holding/cycles', () => {
  const s = fixture(), c = calc(s), p = parts(s, c);
  assert.equal(c.annotations.some(a => ['EVENT_OVERDUE', 'PAYMENT_PENDING', 'LOAN_PENDING'].includes(a.reason_code)), false);
  assert.deepEqual(p.spends[0], { offset_months: 18, cents: 7000000 });
  assert.ok(p.loans[0].principal_cents > 14000000);
  assert.equal(p.loans[0].months, 36);
  assert.equal(p.saving_flows.filter(f => f.source_id.endsWith(':holding')).length, 1);
  assert.equal(p.spends.length, 5);
  assert.equal(oneOffsOf(c.prediction.value.plan)[18], 7000000);
});

test('accidental blank occurred row pauses unknown payments/loan/holding without fabricated zeros', () => {
  const s = fixture(), o = occurred(s), c = calc(s), p = parts(s, c);
  assert.deepEqual(codes(c), ['DEBT_UNLINKED', 'LOAN_PENDING', 'PAYMENT_PENDING', 'POOL_NOT_USED']);
  assert.deepEqual(p.spends, []); assert.deepEqual(p.loans, []);
  assert.deepEqual(p.saving_flows, []); assert.deepEqual(p.spend_flows, []);
  assert.equal(p.principal_cents, null); assert.equal(p.payment_cents, null); assert.equal(p.loan_months, null);
  assert.equal(o.payments[0].amount_cents, null); assert.equal(o.loan, null);
  assert.deepEqual([...oneOffsOf(c.prediction.value.plan)], Array(oneOffsOf(c.prediction.value.plan).length).fill(0));
  assert.deepEqual(c.prediction.value.plan.spends, c.prediction.value.plan0.spends);
  const summary = annotationSummary(c.annotations);
  assert.ok(summary.some(s => s.includes('有 2 项安排未计入') && s.includes('可能偏低')));
  assert.ok(summary.every(s => !s.includes('退休资金资料')), 'unused pool stays out of the visible summary');
  assert.ok(summary.length <= 3);
});

for (const mode of ['excluded', 'manual']) test(`annual 12000 with ${mode} does not demand unrelated pension balances`, () => {
  const s = fixture(); profile(s).retire.basic.retirement_income.mode = mode;
  if (mode === 'manual') {
    profile(s).retire.income_items = [{ id: 'fictional-income', label: '手填退休收入', monthly_cents: '100000', start_age: 60, end_age: null, indexed: true }];
    profile(s).retire.basic.retirement_income.selected = [{ id: 'fictional-income', source_id: 'fictional-income', role: 'other' }];
  }
  const c = calc(s);
  assert.equal(c.pension.status, 'ready'); assert.equal(c.pension.value.monthly_cents, null);
  assert.equal(c.prediction.value.plan.pension_at(720).lump_cents, 0);
  assert.equal(profile(s).retire.core.personal_pension_balance_confirmed, false);
  assert.equal(c.prediction.value.plan.saving_flows.some(f => f.source_id === 'personal_pension'), false, 'historic annual amount alone is not a future cash instruction');
  assert.equal(c.prediction.value.plan.incomes.length, mode === 'manual' ? 1 : 0);
});

test('extra-cost assumption is calculated once, never saved; confirmation removes its annotation', () => {
  const s = fixture(), c = calc(s), P = c.prediction.value.plan, x = parts(s, c);
  assert.equal(c.annotations.filter(a => a.reason_code === 'COST_ASSUMED_EXTRA').length, 4);
  assert.ok(c.annotations.filter(a => a.reason_code === 'COST_ASSUMED_EXTRA').every(a => a.message.includes('暂按额外费用计入，可能重复包含')));
  const expected = x.payment_cents / nominalFactor(P, P.now_months + 18) + 100000;
  near(startPaymentsOf(P)[18], expected);
  near(table(P).spend[18] - 750000, expected);
  assert.deepEqual(profile(s).retire.basic.contribution_costs, []);
  const b = profile(s).retire.basic;
  b.contribution_costs = b.retirement_costs = ['loan', 'holding'].map(k => ({ source_id: `event:demo-car:${k}`, treatment: 'extra', reference_cents: null }));
  const confirmed = calc(s);
  assert.equal(confirmed.annotations.some(a => a.reason_code === 'COST_ASSUMED_EXTRA'), false);
  near(startPaymentsOf(confirmed.prediction.value.plan)[18], expected);
});

test('overdue event pauses the entire future payment and holding stream without moving it to today', () => {
  const s = fixture(); car(s).date = '2026-09'; const c = calc(s), p = parts(s, c);
  assert.ok(codes(c).includes('EVENT_OVERDUE'));
  assert.deepEqual(p.spends, []); assert.deepEqual(p.saving_flows, []); assert.deepEqual(p.spend_flows, []); assert.deepEqual(p.loans, []);
  assert.equal(c.annotations.some(a => a.reason_code === 'COST_ASSUMED_EXTRA'), false);
});

test('known payment after B is charged exactly once; B-absorbed payment never charged again', () => {
  const s = fixture(), o = occurred(s); o.payments_complete = true;
  const p = o.payments[0]; Object.assign(p, { date: '2026-11-01', amount_cents: '200000', account_id: cash(s) });
  const c = calc(s), P = c.prediction.value.plan;
  assert.equal(P.spends.length, 1); const amount = 200000 / nominalFactor(P, P.now_months + 1); near(oneOffsOf(P)[1], amount);
  near(oneOffsOf(P).reduce((a,b) => a+b,0), amount);
  const audit = []; project(P, 2026, { onMonth: r => audit.push(r) });
  near(audit[0].end_cents - audit[1].start_cents, amount);
  near(audit[1].start_cents - audit[1].after_payments_cents, startPaymentsOf(P)[1]);
  Object.assign(p, { date: s.today, absorbed_snapshot_id: s.snapshot.value.id, absorbed_revision: s.snapshot.value.revision });
  const absorbed = calc(s);
  assert.equal(oneOffsOf(absorbed.prediction.value.plan).reduce((a,b) => a+b,0), 0);
  assert.equal(absorbed.funds.value.available_cents, '10000000');
  assert.ok(parts(s, absorbed).saving_flows.some(f => f.source_id.endsWith(':holding')), 'known actual facts permit the known holding stream');
  assert.equal(parts(s, absorbed).principal_cents, null);
});

test('unverified payment source or absorption is omitted with precise fields, not retried at plan price', () => {
  const s = fixture(), o = occurred(s); o.payments_complete = true;
  Object.assign(o.payments[0], { amount_cents: '200000', account_id: cash(s) });
  const c = calc(s);
  assert.equal(parts(s,c).spends.length, 0);
  assert.ok(c.annotations.find(a => a.reason_code === 'PAYMENT_PENDING').missing_fields.includes('盘点吸收关系'));
  assert.equal(o.payments[0].amount_cents, '200000');
});

test('known existing loan continues only future amortization, never deducts principal from available cash', () => {
  const s = fixture(), o = occurred(s); const d = debt(s);
  o.loan = { account_id: d.account_id, principal_cents: d.amount_cents, as_of: s.snapshot.value.date, remaining_months: 10 };
  const c = calc(s), P = c.prediction.value.plan, p = parts(s,c);
  assert.equal(c.funds.value.available_cents, '10000000'); assert.equal(c.funds.value.debt_cents, '500000');
  assert.equal(codes(c).includes('DEBT_UNLINKED'), false); assert.equal(codes(c).includes('LOAN_PENDING'), false);
  assert.equal(p.principal_cents, 500000); assert.equal(P.loans[0].existing, true);
  assert.equal(P.spends.length, 0);
  near(startPaymentsOf(P)[1], p.payment_cents / nominalFactor(P, P.now_months + 1) + 100000);
  assert.equal(debtSeries(P)[0], 500000);
  const audit=[];project(P,2026,{onMonth:r=>audit.push(r)});
  near(audit[0].start_cents - audit[0].after_payments_cents, startPaymentsOf(P)[0]);
});

test('explicit pension cash deposits charged once with no receipt/unlock when pool unused', () => {
  const s = fixture(); profile(s).retire.basic.pension_contributions = { start_month:'2026-11', stop_month:'2027-02', base_cents:null };
  const c=calc(s), P=c.prediction.value.plan;
  const flows=P.saving_flows.filter(f=>f.source_id==='personal_pension');
  assert.equal(flows.length,1);assert.equal(flows[0].cents,-100000);
  const P0={...P,saving_flows:P.saving_flows.filter(f=>f.source_id!=='personal_pension')};
  for(const i of [1,2,3]) near(savingsOf(P0)[i]-savingsOf(P)[i],100000/nominalFactor(P,P.now_months+i));
  near(savingsOf(P0)[4]-savingsOf(P)[4],0);
  assert.equal(startPaymentsOf(P)[1],startPaymentsOf(P0)[1],'month-end transfer must not be charged a second time at month start');
  assert.equal(P.pension_at(720).lump_cents,0);
});

test('chosen Beijing missing facts hard-blocks; explicit excluded switch permits annotated calculation', () => {
  const s=fixture();profile(s).retire.basic.retirement_income.mode='employee';profile(s).worker=null;
  const c=buildBasicCapabilities(s);assert.equal(c.requirement.status,'blocked');
  assert.ok(c.requirement.missing.some(m=>m.code==='PENSION_FACTS_UNKNOWN' && m.message.includes('也可以改选“先不算”先看结果')));
  assert.ok(c.requirement.missing.some(m=>m.code==='POOL_UNCONFIRMED'));
  profile(s).retire.basic.retirement_income.mode='excluded'; calc(s);
  const explicit=prepareBasicPlan(s,undefined,[],'complete',{includePools:true});
  assert.equal(explicit.plan.status,'blocked','explicit pool reference must demand facts');
});

test('same-source conflicting inputs remain hard blockers and never enter the numerical ledger', () => {
  for(const mutate of [s=>profile(s).retire.spend_cents='-1',s=>car(s).down_cents='30000000',s=>profile(s).birth_month='1990-99',s=>profile(s).retire.target_age=90,s=>{const o=occurred(s);o.actual_date='2026-11-01';}]) {
    const s=fixture();mutate(s);const c=buildBasicCapabilities(s);assert.equal(c.requirement.status,'blocked');assert.ok(c.requirement.missing.some(m=>m.code==='INPUT_INVALID'));
  }
});

test('withdrawal removes only a fact-free saved record; repeated withdrawal idempotent, zero/account/absorption/loan facts protected', () => {
  const s=fixture(), o=occurred(s), before=structuredClone(s);
  assert.equal(canRetractOccurrence(o),true);
  const remaining=retractOccurrence(profile(s).retire.core.occurrences,o.id);
  profile(s).retire.core.occurrences=remaining;
  assert.deepEqual(remaining,[]);assert.deepEqual(retractOccurrence(remaining,o.id),[]);
  before.profile.value.saved.profile.retire.core.occurrences=[];
  assert.deepEqual(s,before);assert.equal(parts(s,calc(s)).spends[0].offset_months,18);
  for(const fact of [o=>o.payments[0].amount_cents='0',o=>o.payments[0].account_id=cash(s),o=>o.payments[0].absorbed_revision=1,o=>o.payments[0].absorbed_snapshot_id=s.snapshot.value.id,o=>o.payments[0].source_id='fictional-source',o=>o.loan={account_id:debt(s).account_id,principal_cents:'0',remaining_months:0,as_of:s.today}]) {
    const row=blank(s);fact(row);assert.equal(canRetractOccurrence(row),false);assert.throws(()=>retractOccurrence([row],row.id),/已有实际事实/);
  }
});

test('goals/detail capabilities, overview summary, wish impacts, and compiler retain identical annotations', () => {
  const s=fixture();occurred(s);const c=calc(s), saved=s.profile.value.saved;
  const v=buildRetireCalc(saved,s.snapshot.value,null,[],s.today,s);
  assert.deepEqual(v.annotations,c.annotations);
  const summary=summaryRetire({profile:s.profile,snapshot:s.snapshot,review:s.review,incomes:s.incomes,snapshotId:s.snapshot.value.id,snapshotDate:s.snapshot.value.date,generation:s.generation,writeVersion:s.write_version,modules:s.modules},s.today);
  assert.equal(summary.kind,'ready');assert.deepEqual(summary.calc.annotations,c.annotations);
  assert.deepEqual(impactOf(v,[{id:'fictional-wish',name:'心愿',status:'dated',cents:100000,date:'2027-01-01',offset_months:3}]).annotations,c.annotations);
  const prep=prepareBasicPlan(s);assert.equal(prep.plan.status,'ready');assert.deepEqual(prep.plan.value.compile(100000,300,200).annotations,c.annotations);
});

test('partial explicit future pension transfer is omitted with its own low-side annotation; historic annual alone is not a cash instruction', () => {
  const s=fixture();profile(s).retire.basic.pension_contributions.start_month='2026-11';const c=calc(s);
  assert.ok(c.annotations.some(a=>a.reason_code==='TRANSFER_PENDING' && a.effect==='requirement_lower'));
  assert.equal(c.prediction.value.plan.saving_flows.some(f=>f.source_id==='personal_pension'),false);
});

test('hard Q1-Q4 inputs and required read failures differ from optional history and forecast amount', () => {
  const cases=[s=>profile(s).birth_month=null,s=>profile(s).retire.target_age=null,s=>profile(s).retire.spend_cents=null,s=>profile(s).retire.basic.retirement_income.mode=null,s=>s.snapshot={status:'error',value:{code:'UNAVAILABLE',message:'虚构读取失败'}}];
  for(const mutate of cases){const s=fixture();mutate(s);assert.equal(buildBasicCapabilities(s).requirement.status,'blocked');}
  const s=fixture();profile(s).retire.basic.contribution.monthly_cents=null;const c=buildBasicCapabilities(s);
  assert.equal(c.requirement.status,'ready');assert.equal(c.prediction.status,'blocked');
  assert.ok(c.prediction.missing.some(m=>m.code==='CONTRIBUTION_UNKNOWN'));
  assert.equal(profile(s).retire.basic.contribution.monthly_cents,null);
});

test('stale external payment keeps stored amount but omits the disputed projection; duplicates remain hard', () => {
  const s=fixture(),o=occurred(s);o.payments_complete=true;
  Object.assign(o.payments[0],{date:'2026-11-01',amount_cents:'200000',account_id:cash(s),source_kind:'expense',source_id:'fictional-expense'});
  s.profile.value.saved.reference_issues=['实际来源后来更正'];
  const c=calc(s);assert.equal(parts(s,c).spends.length,0);assert.equal(o.payments[0].amount_cents,'200000');assert.ok(codes(c).includes('REFERENCE_PENDING'));
  s.profile.value.saved.reference_issues=['同一实际付款被重复关联'];assert.equal(buildBasicCapabilities(s).requirement.status,'blocked');
});

import { eventImpact, totalImpact } from '../src/plan-events.ts';
import { verdict } from '../src/plan-view.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';
import { compareCareerScenario } from '../src/plan-career-compare.ts';
import { careerDraft } from '../src/career-preview/fixtures.ts';
import { scaleSaving, scaleSpend } from '../src/plan-ledger.ts';
test('event, verdict, risk input variants, career and comparison carry coverage for their rendering consumers', () => {
  const s=fixture(),c=calc(s),pred=c.prediction.value;
  assert.deepEqual(eventImpact(pred.plan0,toEvent(car(s)),18,0).annotations,c.annotations);
  assert.deepEqual(totalImpact(pred.plan0,[{e:toEvent(car(s)),offset:18}]).annotations,c.annotations);
  assert.deepEqual(verdict(pred.plan,pred.projection,pred.outcome,pred.plan.assets_cents,'today',String).annotations,c.annotations);
  assert.deepEqual(scaleSaving(pred.plan,.8).annotations,c.annotations);assert.deepEqual(scaleSpend(pred.plan,1.1).annotations,c.annotations);
  const d=careerDraft();d.recovery.monthly_cents='800000';const ev=evaluateCareerScenario(s,d);
  assert.ok(ev.notes.some(n=>n.includes('未计入')));assert.ok(ev.notes.some(n=>n.includes('可能重复包含')));
  assert.equal(ev.prediction.status,'ready');assert.deepEqual(ev.prediction.value.plan.annotations,c.annotations);
  const compare=compareCareerScenario(s,d,{kind:'gap',months:6});
  assert.ok(compare.baseline.notes.some(n=>n.includes('未计入')));assert.ok(compare.alternative.notes.some(n=>n.includes('未计入')));
});
