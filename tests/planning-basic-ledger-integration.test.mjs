import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { defaultRetire } from '../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';
import { unknownBasicUpdate } from '../src/plan-basic-fixtures.ts';
import { table, startPaymentsOf, project, outcome, required, requiredAt, coastAmount, glide } from '../src/plan-ledger.ts';
import { monteCarlo } from '../src/plan-risk.ts';

const ready = value => ({ status: 'ready', value });
function sources(pre, post, income, amount = '0', birth = '1956-09') {
  const f = structuredClone(unknownBasicUpdate.fields), b = f.basic;
  b.start = { kind: 'simulation', id: 'fictional-start', available_cents: '0', date: '2026-09-30', notes: 'isolated fictional review' };
  b.contribution.monthly_cents = amount;
  b.retirement_income = { mode: 'manual', selected: [{ id: 'income', source_id: 'annuity', role: 'other' }] };
  b.contribution_costs = [{ source_id: 'event:car:holding', treatment: pre, reference_cents: null }];
  b.retirement_costs = [{ source_id: 'event:car:holding', treatment: post, reference_cents: null }];
  const profile = {
    birth_month: birth, worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null,
    assumptions: { ...defaultAssumptions, inflation_hundredths: 0 }, overrides: noOverrides,
    retire: { ...structuredClone(defaultRetire), spend_cents: '10000', target_age: 70, horizon_age: 71, mode: 'traditional', real_return_before_hundredths: 0, real_return_after_hundredths: 0, volatility_hundredths: 0, basic: b,
      core: { contract_version: 1, monetary_basis_date: f.monetary_basis_date, fund_rules: [], hpf_monthly_cents: null, occurrences: [] },
      income_items: [{ id: 'income', label: 'fictional retirement income', monthly_cents: String(income), start_age: 0, end_age: null, indexed: true }],
      life_events: [{ id: 'car', label: 'fictional car', kind: 'car', date: '2026-10', included: true, price_cents: '0', down_cents: '0', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 1, holding_cents: '10000', rent_saved_cents: '0', cycle_years: null, until_age: null, resale_cents: '0' }],
    },
  };
  return { generation: 'fictional', write_version: 1, today: '2026-10-07', modules: { planning: true, wealth: false }, profile: ready({ generation: 'fictional', saved: { revision: 1, updated_at: '2026-10-07', profile } }), snapshot: ready(null), accounts: ready([]), review: { status: 'error', value: { code: 'UNAVAILABLE', message: 'no fictional history' } }, incomes: ready([]) };
}
function prediction(s) {
  const c = buildBasicCapabilities(s);
  assert.equal(c.prediction.status, 'ready', JSON.stringify(c.prediction));
  return c.prediction.value;
}

test('retirement exclusion stops upfront charges despite an accumulation expense scope', async () => {
  const s = sources('extra', 'excluded', 10000), v = prediction(s);
  assert.equal(table(v.plan).spend[1], 10000);
  assert.equal(startPaymentsOf(v.plan)[1], 10000);
  assert.equal(startPaymentsOf(v.plan, 'retired')[1], 0);
  assert.equal(v.outcome.success, true);
  assert.equal(v.outcome.at_horizon, 0);
  assert.equal(buildBasicCapabilities(s).requirement.value.set.status, 'no_positive_contribution');
  assert.equal((await monteCarlo(v.plan, 8)).success_rate, 1);
});

test('retirement-only month-start fees cannot be financed by month-end retirement income', async () => {
  const s = sources('excluded', 'extra', 20000), v = prediction(s);
  assert.equal(table(v.plan).spend[1], 20000);
  assert.equal(startPaymentsOf(v.plan)[1], 0);
  assert.equal(startPaymentsOf(v.plan, 'retired')[1], 10000);
  assert.equal(v.outcome.success, false);
  assert.equal(v.outcome.failure_month, v.plan.now_months + 1);
  assert.equal(v.outcome.required_at_goal, 10000);
  assert.equal((await monteCarlo(v.plan, 8)).success_rate, 0);
  const req = requiredAt(v.plan);
  for (let t = 0; t < req.length; t++) assert.equal(req[t], required(v.plan, v.plan.now_months + t));
});

test('FIRE delay uses accumulation expense scope until actual retirement', async () => {
  const v = prediction(sources('excluded', 'extra', 20000, '5000', '1957-09'));
  const p = { ...v.plan, mode: 'fire', assets_cents: 0, target_months: v.plan.now_months, horizon_months: v.plan.now_months + 4, first_month_fraction: 1, spend_flows: v.plan.spend_flows.map(f => ({ ...f, from_month: v.plan.now_months })) };
  const proj = project(p, 2026), out = outcome(p, proj);
  assert.equal(proj.retire_month, p.now_months + 2);
  assert.deepEqual([...proj.assets], [0, 5000, 10000, 10000, 10000]);
  assert.equal(out.success, true);
  assert.equal((await monteCarlo(p, 8)).success_rate, 1);
});


test('basic pool unlock precedes a later retirement and supports next-month payment exactly once', async () => {
  const v = prediction(sources('excluded', 'excluded', 0));
  const p = { ...v.plan, now_months: 800, target_months: 803, horizon_months: 806, assets_cents: 0, saving_cents: 0, first_month_fraction: 1, items: [], incomes: [], saving_flows: [], spend_flows: [], spends: [{ offset_months: 2, cents: 10000 }], pension_at: () => ({ monthly_cents: 0, lump_cents: 10000, unlock_age_months: 801 }) };
  const proj = project(p, 2026), out = outcome(p, proj);
  assert.deepEqual([...proj.assets], [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(proj.rows.reduce((sum, row) => sum + row.unlock, 0), 10000);
  assert.equal(out.success, true);
  assert.equal(out.required_at_goal, 0);
  assert.equal((await monteCarlo(p, 8)).success_rate, 1);
  const req = requiredAt(p);
  for (let t = 0; t < req.length; t++) assert.equal(req[t], required(p, p.now_months + t));
});

test('cash already received from a basic pool cannot reduce the retirement requirement again', async () => {
  const v = prediction(sources('excluded', 'excluded', 0));
  const p = { ...v.plan, now_months: 800, target_months: 803, horizon_months: 805, assets_cents: 0, saving_cents: 0, first_month_fraction: 1, items: [{ id: 'living', label: 'fictional', monthly_cents: 10000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }], incomes: [], saving_flows: [], spend_flows: [], spends: [], pension_at: () => ({ monthly_cents: 0, lump_cents: 10000, unlock_age_months: 801 }) };
  const proj = project(p, 2026), out = outcome(p, proj);
  assert.equal(proj.assets[3], 10000);
  assert.equal(out.required_at_goal, 20000);
  assert.equal(coastAmount(p), 10000);
  assert.equal(glide(p, proj)[0], 10000);
  assert.equal(out.funded_at_goal, false);
  assert.equal(out.success, false);
  assert.equal((await monteCarlo(p, 8)).success_rate, 0);
  const req = requiredAt(p);
  for (let t = 0; t < req.length; t++) assert.equal(req[t], required(p, p.now_months + t));
});

test('switching an event off and on retains fees and confirmed live account purposes', async () => {
  const { draftOf, basicInput } = await import('../src/planning-basic-forms.ts');
  const s = sources('extra', 'extra', 10000, '5000', '1990-06');
  const r = s.profile.value.saved.profile.retire;
  s.modules.wealth = true;
  r.basic.start = { kind: 'live' };
  r.core.fund_rules = [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }];
  s.snapshot = ready({ id: 'snap', revision: 1, date: '2026-09-30', missing: [], entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: '1000000' }] });
  const original = structuredClone(r.basic);
  for (const included of [true, false, true, false, true]) {
    r.life_events[0].included = included;
    const c = buildBasicCapabilities(s);
    assert.equal(c.funds.status, 'ready');
    assert.equal(c.requirement.status, 'ready', JSON.stringify(c.requirement));
    const d = draftOf(s.profile.value.saved, s.snapshot.value, s.today);
    r.basic = basicInput(d, s.profile.value.saved, s.today).fields.basic;
    assert.deepEqual(r.basic.contribution_costs, original.contribution_costs);
    assert.deepEqual(r.basic.retirement_costs, original.retirement_costs);
  }
  r.life_events.push({ ...r.life_events[0], id: 'new-event' });
  assert.ok(buildBasicCapabilities(s).requirement.missing.some(m => m.code === 'COST_SCOPE_UNKNOWN'));
});

test('inactive included fees do not subtract from current budget; duplicate and missing sources still block', () => {
  const s = sources('extra', 'included', 10000, '5000', '1990-06');
  const r = s.profile.value.saved.profile.retire;
  r.life_events[0].included = false;
  r.basic.retirement_costs[0].reference_cents = '999999';
  assert.equal(buildBasicCapabilities(s).requirement.status, 'ready');
  r.basic.retirement_costs.push({ ...r.basic.retirement_costs[0] });
  assert.ok(buildBasicCapabilities(s).requirement.missing.some(m => m.code === 'COST_SCOPE_INVALID'));
  r.basic.retirement_costs.pop(); r.life_events = [];
  assert.ok(buildBasicCapabilities(s).requirement.missing.some(m => m.code === 'COST_SCOPE_INVALID'));
});

test('dedicated cost review preserves all saved non-cost basic inputs exactly', async () => {
  const { draftOf, costsInput } = await import('../src/planning-basic-forms.ts');
  const s = sources('extra', 'extra', 10000, '5000', '1990-06');
  const saved = s.profile.value.saved, before = structuredClone(saved.profile.retire.basic);
  before.pension_contributions = { start_month: '2025-01', stop_month: '2050-06', base_cents: '1234567' };
  saved.profile.retire.basic = before;
  const d = draftOf(saved, null, '2026-10-08'); d.retScopes['event:car:holding'] = { treatment: 'excluded', ref: '' };
  const after = costsInput(d, saved).fields.basic;
  assert.deepEqual({ ...after, contribution_costs: before.contribution_costs, retirement_costs: before.retirement_costs }, before);
  assert.equal(after.retirement_costs[0].treatment, 'excluded');
  assert.equal(costsInput(d, saved).fields.spend_cents, saved.profile.retire.spend_cents);
});
