import test from 'node:test';
import assert from 'node:assert/strict';
import { medicalCheck } from '../src/plan-medical.ts';
import { medicalView } from '../src/planning-goal/medical-view.ts';
import { medicalInput, medicalFormOf } from '../src/planning-basic-forms.ts';
import { fictionalSources } from './planning-basic.test.mjs';
import { buildBasicCapabilities, prepareBasicPlan, solveBasicRequirement } from '../src/plan-basic.ts';
const today = '2026-10-11';
test('prototype distinguishes complete 15/15/60 facts from projected shortfall and cost coverage', () => {
  const { p, b } = fixture();
  Object.assign(p, { medical_paid_months: 15, medical_local_paid_months: 15, medical_local_required_months: 60 });
  b.pension_contributions.stop_month = '2050-06';
  const m = medicalCheck(p, b, '2026-10-12');
  assert.deepEqual(m.missing, []);
  assert.equal(m.projected_months, 298);
  assert.equal(m.local_projected_months, 298);
  assert.equal(m.required_months, 300);
  assert.equal(m.short_months, 2);
  const view = medicalView(m, null);
  assert.equal(view.next, '处理医保缴费缺口');
  assert.match(view.title, /还差 2 个月/);
  assert.equal(view.pending, true);
  assert.equal(medicalView(m, '100000').pending, false);
  assert.match(medicalView(m, '100000').title, /还差 2 个月/);
  p.medical_local_required_months = null;
  assert.equal(medicalView(medicalCheck(p, b, today), null).next, '核对适用的医保政策门槛');
  p.medical_local_required_months = 60; p.medical_paid_months = 17;
  assert.match(medicalView(medicalCheck(p, b, today), null).title, /预计满足年限/);
});
function fixture() {
  const s = fictionalSources('1000000'), p = s.profile.value.saved.profile;
  Object.assign(p, { region: 'beijing', worker: 'male', birth_month: '1990-06', flex_months: 0, medical_paid_months: 100, medical_local_paid_months: 30, medical_local_required_months: 120 });
  p.retire.basic.pension_contributions = { start_month: '2026-10', stop_month: '2030-06', base_cents: null };
  return { s, p, b: p.retire.basic };
}
test('medical male/female and Beijing local five/ten years; half-open dates', () => {
  const { p, b } = fixture();
  let m = medicalCheck(p, b, today);
  assert.equal(m.at_month, '2053-06'); assert.equal(m.projected_months, 143); assert.equal(m.short_months, 157);
  for (const worker of ['female_cadre', 'female_worker']) { p.worker = worker; m = medicalCheck(p, b, today); assert.equal(m.required_months, 240); }
  p.medical_paid_months = 300; p.medical_local_paid_months = 0;
  p.medical_local_required_months = 60; assert.equal(medicalCheck(p, b, today).short_months, 17);
  p.medical_local_required_months = 120; assert.equal(medicalCheck(p, b, today).short_months, 77);
});
test('medical exact threshold, satisfied, unknown dates, custom/null region, no local requirement', () => {
  const { p, b } = fixture(); p.medical_paid_months = 257; p.medical_local_paid_months = 77;
  assert.equal(medicalCheck(p, b, today).status, 'ok');
  p.medical_paid_months++; assert.equal(medicalCheck(p, b, today).status, 'ok');
  b.pension_contributions.stop_month = null; assert.equal(medicalCheck(p, b, today).status, 'unknown');
  b.pension_contributions.stop_month = '2026-10';
  for (const region of ['custom', null]) {
    p.region = region; p.medical_local_required_months = null; p.medical_local_paid_months = null;
    assert.equal(medicalCheck(p, b, today).status, 'unknown');
    p.medical_required_months = 240; assert.equal(medicalCheck(p, b, today).status, 'ok'); p.medical_required_months = null;
  }
});
test('medical check only for early retirement or explicitly entered facts', () => {
  const { p, b } = fixture();
  for (const key of Object.keys(p).filter(k => k.startsWith('medical_'))) delete p[key];
  p.retire.target_age = 63; assert.equal(medicalCheck(p, b, today).status, 'not_needed');
  p.retire.target_age = 50; assert.equal(medicalCheck(p, b, today).status, 'unknown');
  p.worker = null; assert.equal(medicalCheck(p, b, today).status, 'not_needed');
  p.medical_paid_months = 0; assert.equal(medicalCheck(p, b, today).status, 'unknown');
});
test('medical inclusive retirement cap and elastic retirement month', () => {
  const { p, b } = fixture(); b.pension_contributions = { start_month: '2053-05', stop_month: '2054-01', base_cents: null };
  assert.equal(medicalCheck(p, b, today).projected_months, 102);
  p.flex_months = -12; assert.equal(medicalCheck(p, b, today).at_month, '2052-06');
  assert.equal(medicalCheck(p, b, today).projected_months, 100);
});
test('medical form blanks, years and invalid input', () => {
  assert.deepEqual(medicalInput(medicalFormOf(null)), { medical_paid_months: null, medical_local_paid_months: null, medical_required_months: null, medical_local_required_months: null, medical_topup_cents: null });
  const f = medicalFormOf({ medical_required_months: 300, medical_local_required_months: 60 });
  assert.equal(f.medicalRequired, '25'); assert.equal(medicalInput(f).medical_local_required_months, 60);
  assert.throws(() => medicalInput({ ...f, medicalPaid: '5', medicalLocal: '6' }));
  assert.throws(() => medicalInput({ ...f, medicalTopup: '-1' }));
});
test('medical omission leaves required contribution unchanged; explicit topup equals same dated one-off', () => {
  const { s, p } = fixture();
  const base = buildBasicCapabilities(s); assert.equal(base.requirement.status, 'ready');
  assert.ok(base.annotations.some(a => a.reason_code === 'MEDICAL_YEARS_SHORT' && a.treatment === 'omitted'));
  p.medical_paid_months = 500; p.medical_local_paid_months = 200;
  assert.deepEqual(buildBasicCapabilities(s).requirement, base.requirement);
  p.medical_paid_months = 100; p.medical_local_paid_months = 30;
  const before = prepareBasicPlan(s).plan.value;
  p.medical_topup_cents = '6000000';
  const prepared = prepareBasicPlan(s), after = buildBasicCapabilities(s);
  assert.equal(prepared.plan.status, 'ready'); assert.equal(after.requirement.status, 'ready');
  assert.equal(prepared.plan.value.compile(0, 0, 0).spends.length, 1);
  const anchor = before.compile(0, 0, 0).anchor_date;
  const offset = (2053 - Number(anchor.slice(0, 4))) * 12 + 6 - Number(anchor.slice(5, 7));
  assert.deepEqual(prepared.plan.value.compile(0, 0, 0).spends, [{ offset_months: offset, cents: 6000000 }]);
  assert.ok(Number(after.requirement.value.set.monthly_cents) > Number(base.requirement.value.set.monthly_cents));
  assert.deepEqual(solveBasicRequirement((amount, a, b) => ({ ...before.compile(amount, a, b), spends: [{ offset_months: offset, cents: 6000000 }] }), 0, 0), solveBasicRequirement(prepared.plan.value.compile, 0, 0));
  p.medical_paid_months = null; assert.equal(buildBasicCapabilities(s).requirement.status, 'ready');
});

test('missing policy is distinct from missing personal records and remains unknown', () => {
  const { p, b } = fixture();
  p.medical_local_required_months = null;
  let result = medicalCheck(p, b, today);
  assert.equal(result.status, 'unknown');
  assert.equal(result.short_months, null);
  assert.match(medicalView(result, null).title, /已缴记录已填/);
  assert.match(medicalView(result, null).explanation, /留空仍可保存并继续试算/);
  p.medical_paid_months = null;
  assert.equal(medicalView(medicalCheck(p, b, today), null).next, '补充医保资料');
});
