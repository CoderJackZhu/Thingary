import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBasicCapabilities, prepareBasicPlan } from '../src/plan-basic.ts';
import { defaultRetire } from '../src/plan.ts';
import { emptyCore } from '../src/plan-core.ts';
import { unknownBasicUpdate } from '../src/plan-basic-fixtures.ts';

const ready = value => ({ status: 'ready', value });
const SELF_BIRTH = '1990-01';
function sources(household, mode = 'fire', target = '2026-10') {
  const f = structuredClone(unknownBasicUpdate.fields), b = f.basic;
  b.start = { kind: 'simulation', id: 'fictional-start', available_cents: '0', date: '2026-09-30', notes: 'isolated fictional review' };
  b.contribution.monthly_cents = '100000';
  b.contribution_costs = []; b.retirement_costs = [];
  const profile = {
    assumptions: { inflation_hundredths: 0 },
    retire: { ...structuredClone(defaultRetire), spend_cents: '10000', mode, real_return_before_hundredths: 0, real_return_after_hundredths: 0, volatility_hundredths: 0, basic: b, core: emptyCore(f.monetary_basis_date), life_events: [], spend_items: [], rent_cents: '0',
      simplified: { contract_version: 1, time: { reference: null, target_month: target, horizon_month: '2086-09' }, income_mode: 'excluded', future_incomes: [], household } },
  };
  return { generation: 'fictional', write_version: 1, today: '2026-10-07', modules: { planning: true, wealth: false }, profile: ready({ generation: 'fictional', saved: { revision: 1, updated_at: '2026-10-07', profile } }), snapshot: ready(null), accounts: ready([]), review: { status: 'error', value: { code: 'UNAVAILABLE', message: 'none' } }, incomes: ready([]) };
}
const single = { mode: 'single', partner: null };
const couple = (stop_age_months, monthly_cents, birth_month = '1990-01') => ({ mode: 'couple', partner: { birth_month, stop_age_months, monthly_cents } });
// partner born 1990-01: age months 420 -> 2025-01 (past), 444 -> 2027-01, 600 -> 2040-01, 480 -> 2030-01
const compiler = s => { const p = prepareBasicPlan(s); assert.equal(p.plan.status, 'ready', JSON.stringify(p.plan)); return p; };
const month = i => Number(i.slice(0, 4)) * 12 + Number(i.slice(5, 7));

test('single and couple-same-time compile to the identical plan', () => {
  const a = compiler(sources(single)).plan.value, b = compiler(sources(couple(null, null))).plan.value;
  assert.equal(JSON.stringify(a.compile(100000, 300, 200)), JSON.stringify(b.compile(100000, 300, 200)));
  assert.equal(JSON.stringify(a.compile(0, 300, 200, false)), JSON.stringify(b.compile(0, 300, 200, false)));
  assert.deepEqual(compiler(sources(couple(null, null))).annotations, []);
});

test('split plan: generated income months and amount, saving reduced, nothing persisted', () => {
  const s = sources(couple(600, '40000'));
  const before = JSON.stringify(s);
  const plan = compiler(s).plan.value.compile(100000, 0, 0);
  assert.equal(plan.saving_cents, 60000);
  const gen = plan.future_incomes.filter(i => i.id === 'household-partner-work');
  assert.equal(gen.length, 1);
  assert.deepEqual(gen[0], { id: 'household-partner-work', name: '伴侣停工前的结余', role: 'other', included: true, monthly_cents: '40000', start_month: '2026-09', end_month: '2039-12', basis: 'reference_month', basis_month: '2026-09', growth: 'constant_purchasing_power', source: null, source_checked_on: null, notes: '' });
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(s.profile.value.saved.profile.retire.simplified.future_incomes, []);
});

test('unknown share and already-stopped partner keep the unsplit plan and annotate', () => {
  const base = JSON.stringify(compiler(sources(single)).plan.value.compile(100000, 0, 0));
  const unknown = compiler(sources(couple(600, null)));
  assert.equal(unknown.annotations.filter(a => a.reason_code === 'HOUSEHOLD_SHARE_UNKNOWN').length, 1);
  assert.equal(unknown.annotations[0].refinement.field, 'household.partner.monthly_cents');
  const stopped = compiler(sources(couple(420, '40000')));
  assert.equal(stopped.annotations.filter(a => a.reason_code === 'HOUSEHOLD_PARTNER_STOPPED').length, 1);
  for (const p of [unknown, stopped]) {
    const plan = p.plan.value.compile(100000, 0, 0);
    assert.equal(plan.saving_cents, 100000);
    assert.ok(!plan.future_incomes.some(i => i.id === 'household-partner-work'));
    assert.equal(JSON.stringify({ ...plan, annotations: 0 }), JSON.stringify({ ...JSON.parse(base), annotations: 0 }));
  }
  assert.equal(buildBasicCapabilities(sources(couple(600, null))).annotations.some(a => a.reason_code === 'HOUSEHOLD_SHARE_UNKNOWN'), true);
});

test('partner working longer retires me earlier; stopping earlier, later', () => {
  const stop = c => { const v = c.prediction.value; return month(v.plan.anchor_date.slice(0, 7)) + v.projection.retire_month; };
  const same = buildBasicCapabilities(sources(single));
  assert.equal(same.prediction.value.household, undefined);
  const cl = buildBasicCapabilities(sources(couple(600, '5000'))), ce = buildBasicCapabilities(sources(couple(444, '5000')));
  const hl = cl.prediction.value.household, he = ce.prediction.value.household;
  assert.equal(hl.partner_stop_month, '2040-01');
  assert.equal(he.partner_stop_month, '2027-01');
  // same-time run is the unsplit single-person plan
  assert.equal(hl.same_time_stop_month, he.same_time_stop_month);
  assert.equal(month(hl.same_time_stop_month), stop(same));
  assert.ok(stop(cl) < month(hl.same_time_stop_month), 'partner working longer: earlier');
  assert.ok(stop(ce) > month(he.same_time_stop_month), 'partner stopping earlier: later');
  assert.equal(month(hl.both_stop_month), Math.max(stop(cl), month('2040-01')));
  assert.equal(month(he.both_stop_month), stop(ce));
  assert.equal(buildBasicCapabilities(sources(couple(null, null))).prediction.value.household.same_time_stop_month, null);
});

test('requirement reports the household total while the partner works', () => {
  const req = h => buildBasicCapabilities(sources(h, 'traditional', '2056-10')).requirement.value.set;
  const unsplit = req(single), split = req(couple(600, '5000'));
  assert.equal(prepareBasicPlan(sources(couple(600, '5000'), 'traditional', '2056-10')).plan.value.compile.household_share_cents, 5000);
  assert.equal(split.status, 'found');
  assert.equal(unsplit.status, 'found');
  // household total = own part + 5000 while the partner works. The partner stops in 2040, so the
  // household must save more now than the flat single-person figure; the extra is the post-2040 gap.
  assert.ok(Number(split.monthly_cents) > Number(unsplit.monthly_cents), JSON.stringify([split, unsplit]));
  // Partner working through the whole accumulation: the household total matches the unsplit figure (up to first-month proration).
  assert.ok(Math.abs(Number(req(couple(800, '5000')).monthly_cents) - Number(unsplit.monthly_cents)) < 50);
  assert.deepEqual(req(couple(null, null)), unsplit);
  assert.deepEqual(req(couple(600, null)), unsplit);
  // the summary also works in traditional mode: my stop month is the target month
  const h = buildBasicCapabilities(sources(couple(600, '5000'), 'traditional', '2056-10')).prediction.value.household;
  assert.equal(h.both_stop_month, '2056-10');
  assert.equal(h.same_time_stop_month, '2056-10');
});
