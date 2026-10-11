import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifiedEmpty, ageToMonthV1, validateSimplifiedPlanningV1, incomeAtMonthV1 } from '../src/plan-simplified.ts';
import { createSimplifiedPlanningPortV1 } from '../src/planning-simplified-port.ts';
const income = () => ({ id: 'fictional-income', name: '虚构外部养老金', role: 'pension', included: true, monthly_cents: '10000', start_month: '2030-01', end_month: null, basis: 'start_month', basis_month: null, growth: 'fixed_nominal', source: null, source_checked_on: null, notes: '' });
test('months stay fixed across reference edits, direct calendar entry needs no age', () => {
  assert.equal(ageToMonthV1({ month: '2026-12', age_months: 400 }, 402), '2027-02');
  assert.equal(ageToMonthV1({ month: '2027-01', age_months: 401 }, 402), '2027-02');
  assert.throws(() => ageToMonthV1(null, 402));
  assert.deepEqual(validateSimplifiedPlanningV1(simplifiedEmpty()), []);
});
test('unknown, explicit zero, excluded and unconfirmed remain different values', () => {
  const i = income(); assert.equal(incomeAtMonthV1({ ...i, monthly_cents: null }, '2030-01', '2030-01', 0), null);
  assert.equal(incomeAtMonthV1({ ...i, monthly_cents: '0' }, '2030-01', '2030-01', 0), 0);
  assert.equal(incomeAtMonthV1({ ...i, included: false }, '2030-01', '2030-01', 0), null);
  for (const mode of ['manual','excluded','unconfirmed']) assert.deepEqual(validateSimplifiedPlanningV1({ ...simplifiedEmpty(), income_mode: mode, future_incomes: [i] }), []);
});
test('fixed nominal vs purchasing power use explicit integer months, both endpoints inclusive', () => {
  const i = { ...income(), start_month: '2027-01', end_month: '2028-01', basis: 'reference_month', basis_month: '2026-01' };
  assert.equal(incomeAtMonthV1(i, '2026-12', '2026-01', 1000), 0);
  assert.ok(Math.abs(incomeAtMonthV1(i, '2027-01', '2026-01', 1000)-10000) < 1e-8);
  assert.ok(Math.abs(incomeAtMonthV1(i, '2028-01', '2026-01', 1000)-10000/1.1) < 1e-8);
  assert.equal(incomeAtMonthV1(i, '2028-02', '2026-01', 1000), 0);
  assert.equal(incomeAtMonthV1({ ...i, growth:'constant_purchasing_power' }, '2028-01', '2026-01', 1000), 10000);
  assert.equal(incomeAtMonthV1(i, '2028-01', '2026-01', null), null);
});
test('validation uses stable IDs and rejects noncanonical/over-limit amounts', () => {
  for (const n of ['-1','01','100000001']) assert.ok(validateSimplifiedPlanningV1({ ...simplifiedEmpty(), future_incomes:[{...income(),monthly_cents:n}] }).some(x=>x.path==='future_incomes.fictional-income.monthly_cents'));
});
test('partition/setup adapters delegate once, retain unresolved and propagate read failures', async () => {
  const calls=[]; const f=simplifiedEmpty(), c={request_id:'fictional-request',generation:'fictional-library',expected_revision:null};
  const port=createSimplifiedPlanningPortV1({ read:async()=>{throw Error('read failure')}, save:async(...x)=>{calls.push(x);return {status:'unresolved',request_id:c.request_id}}, saveSetup:async(...x)=>{calls.push(x);return {status:'saved',revision:1}}, resolve:async()=>({status:'rejected',issues:[]}) });
  await assert.rejects(port.read(), /read failure/);
  assert.deepEqual(await port.save(f,c),{status:'unresolved',request_id:c.request_id});
  assert.equal(calls.length,1);
  assert.equal((await port.saveSetup({fields:f,setup:{}},c)).status,'saved'); assert.equal(calls.length,2);
});
