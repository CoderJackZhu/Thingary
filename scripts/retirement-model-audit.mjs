// Fictional, reproducible design checks; not an entitlement or safe-retirement promise.
import assert from 'node:assert/strict';
import { fictionalSources } from '../tests/helpers/planning-fixtures.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { required } from '../src/plan-ledger.ts';

const s = fictionalSources('0'), p = s.profile.value.saved.profile, r = p.retire;
Object.assign(p, { worker: 'male', region: 'beijing', paid_months: 200, account_balance_cents: '5000000', base_cents: '1500000', flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 0 });
r.core.hpf_monthly_cents = '0'; r.basic.retirement_income.mode = 'employee';
r.basic.pension_contributions = { start_month: '2027-01', stop_month: '2053-06', base_cents: '1500000' };
r.mode = 'fire'; r.target_age = 45; r.basic.start.available_cents = '100000000';
const summarize = c => {
  assert.equal(c.prediction.status, 'ready'); assert.equal(c.requirement.status, 'ready');
  const v = c.prediction.value;
  return { target_required_cents: Math.round(required(v.plan, 540)), fi_age_months: v.projection.fi_month,
    monthly_saving_cents: c.requirement.value.set.monthly_cents,
    omitted_cost_disclosed: c.annotations.some(a => a.reason_code === 'PENSION_COST_UNCONFIRMED') };
};
const omitted = summarize(buildBasicCapabilities(s));
r.keep_paying_monthly_cents = '300000'; r.keep_paying_until_age = 63;
const paid = summarize(buildBasicCapabilities(s));
assert.equal(paid.target_required_cents - omitted.target_required_cents, 300000 * 18 * 12);
assert.equal(omitted.omitted_cost_disclosed, true);
assert.equal(paid.omitted_cost_disclosed, false);

const base = buildBasicCapabilities(fictionalSources('0')).prediction.value.plan;
const scenarios = [];
for (const horizon of [90, 95, 100]) for (const indexed of [true, false]) {
  const plan = { ...base, now_months: 720, target_months: 720, horizon_months: horizon * 12,
    first_month_fraction: 1, basis_factor: 1, inflation_hundredths: 200,
    r_after_hundredths: 0, pension_at: () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 720 }),
    incomes: [{ id: 'pension', label: '虚构养老金', monthly_cents: 300000, start_age: 60, end_age: null, indexed }] };
  const months = (horizon - 60) * 12;
  const expected = Array.from({ length: months }, (_, i) => 400000 - 300000 / (indexed ? 1 : 1.02 ** (i / 12))).reduce((a, b) => a + b, 0);
  const actual = required(plan, 720);
  assert.ok(Math.abs(actual - expected) < 0.01);
  scenarios.push({ horizon_age: horizon, pension_tracks_inflation: indexed, required_cents: Math.round(actual) });
}
console.log(JSON.stringify({ status: 'fictional arithmetic verified; policy calibration remains incomplete',
  contribution_costs: { omitted, paid, difference_cents: paid.target_required_cents - omitted.target_required_cents },
  purchasing_power_and_longevity: scenarios }, null, 2));
