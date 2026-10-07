import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetireCalc, keepFor, leaveCost } from '../src/plan-retire-calc.ts';
import { pensionTable } from '../src/plan-fire.ts';
import { project } from '../src/plan-pension.ts';
import { eventParts } from '../src/plan-events.ts';
import { table } from '../src/plan-ledger.ts';
import { defaultRetire } from '../src/plan.ts';
import { beijing, defaultAssumptions, noOverrides } from '../src/plan-params.ts';

// 虚构资料，数字好算。
const profile = { birth_month: '1990-06', worker: 'male', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000, assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 } };
const region = { ...beijing, notional_rate_hundredths: 0, hpf_rate_hundredths: 0 };
const funds = { hpf_balance_cents: '0', hpf_monthly_cents: '300000' };
const TODAY = '2026-10-06';
const saved = retire => ({ revision: 1, updated_at: TODAY, profile: { ...profile, region: 'beijing', assumptions: defaultAssumptions, overrides: noOverrides, retire: { ...defaultRetire, core: { contract_version: 1, monetary_basis_date: '2026-10-06', fund_rules: [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }], hpf_monthly_cents: '0', costs: [], occurrences: [] }, saving_phases: [{ id: 'default-explicit', label: '显式测试假设', from_age_months: 0, monthly_cents: 1000000 }], spend_cents: '500000', ...retire } } });
const snapshot = { entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: '20000000' }] };
const review = { intervals: [], stats: { median_monthly_saving_cents: '1000000', median_monthly_spend_cents: null } };

test('paying on after you stop working adds contribution months and the pension that comes with them', () => {
  const stop = pensionTable(profile, region, TODAY, funds, 436, 756)(480);
  const keep = pensionTable(profile, region, TODAY, funds, 436, 756, [], { keepUntil: 756, base: 727_000 })(480);
  assert.equal(stop.eligible, false);
  assert.equal(stop.monthly_cents, 0);
  assert.equal(keep.eligible, true, 'enough years once the self-paid months count');
  assert.ok(keep.monthly_cents > 0);
  // 自缴期间没有公积金：续缴不会多出公积金。
  assert.ok(keep.lump_cents <= stop.lump_cents + 1);
  // 辞职晚于续缴年龄：没有什么可续缴，结果与不续缴相同。
  const late = pensionTable(profile, region, TODAY, funds, 436, 756, [], { keepUntil: 600, base: 0 })(700);
  assert.deepEqual(late, pensionTable(profile, region, TODAY, funds, 436, 756)(700));
});

test('gap months that stop contributions lower the contribution months, the provident fund and the pension', () => {
  const full = project(profile, region, TODAY, 756, funds);
  const gappy = project(profile, region, TODAY, 756, funds, [], m => (m < 600 ? 1 : 0));
  assert.ok(gappy.total_paid_months < full.total_paid_months);
  assert.equal(full.total_paid_months - gappy.total_paid_months, 600 - 436);
  assert.ok(gappy.hpf_at_start_cents < full.hpf_at_start_cents && gappy.total_today_cents < full.total_today_cents);
  const half = project(profile, region, TODAY, 756, funds, [], () => 0.5);
  assert.equal(full.total_paid_months - half.total_paid_months, Math.round((756 - 436) / 2));
  assert.deepEqual(project(profile, region, TODAY, 756, funds, [], () => 0), full, 'no idle share changes nothing');
});

test('which months count as gap months: negative saving phases, the average share, a route, or none when you keep paying', () => {
  const phases = [{ id: 'a', label: '空窗', from_age_months: 0, monthly_cents: -600_000 }, { id: 'b', label: '有收入', from_age_months: 440, monthly_cents: 1_700_000 }];
  const r = { ...defaultRetire, saving_phases: phases, gap_share_hundredths: 1000 };
  const idle = keepFor(r, 436).idle;
  assert.deepEqual([idle(436), idle(440), idle(600)], [1, 0.1, 0.1]);
  assert.equal(keepFor({ ...defaultRetire }, 436).idle(500), 0, 'no phases, no gap');
  const routed = keepFor({ ...r, route_id: 'tech', route_from_age: 40 }, 436).idle;
  assert.deepEqual([routed(450), routed(480)], [0.1, 0.15]);
  assert.equal(keepFor({ ...r, gap_keeps_paying: true }, 436).idle, undefined);
  const k = keepFor({ ...defaultRetire, keep_paying_until_age: 60, keep_paying_base_cents: '727000' }, 436);
  assert.deepEqual([k.keepUntil, k.base], [720, 727000]);
  assert.deepEqual([keepFor(defaultRetire, 436).keepUntil], [null]);
});

test('rent and self-paid insurance are essential spending after leaving, and a house purchase takes over the rent', () => {
  const r = buildRetireCalc(saved({ rent_cents: '600000', keep_paying_until_age: 55, keep_paying_monthly_cents: '212000', keep_paying_base_cents: '727000' }), snapshot, review, [], TODAY);
  const T = table(r.plan);
  assert.equal(T.essential[0], 500_000 + 600_000 + 212_000);
  const at55 = (55 * 12 - r.now);
  assert.equal(T.essential[at55 - 1], 1_312_000, 'still paying the month before 55');
  assert.equal(T.essential[at55], 1_100_000, 'after the self-paid years only the rent is left');
  assert.equal(r.emergency.covered_months, r.assets / 1_312_000, 'the emergency line counts every essential cost');
  // 买房：购买月起房租取消，取消额不超过房租本身。
  const house = { id: 'h', label: '房', kind: 'house', date: '2030-01', included: true, price_cents: 0, down_cents: 0, extra_cents: 0, loan_rate_hundredths: 0, loan_years: 0, holding_cents: 0, rent_saved_cents: 900_000, cycle_years: null, until_age: null, resale_cents: 0 };
  const parts = eventParts(r.plan, house, 40);
  const cancel = parts.spend_flows.find(f => f.label.includes('不再付房租'));
  assert.equal(cancel.cents, -600_000);
  assert.equal(eventParts({ ...r.plan, rent_cents: 0 }, house, 40).spend_flows.some(f => f.label.includes('不再付房租')), false);
});

test('without the new inputs nothing changes: no extra flows and no idle months', () => {
  const r = buildRetireCalc(saved({}), snapshot, review, [], TODAY);
  assert.deepEqual(r.plan.spend_flows, []);
  assert.equal(leaveCost(defaultRetire, 500_000), 500_000);
  assert.equal(table(r.plan).essential[0], 500_000);
});

test('while gap months keep paying, the self-paid cost is part of what a jobless month costs', () => {
  const r = { ...defaultRetire, rent_cents: '600000', keep_paying_monthly_cents: '212000', gap_keeps_paying: true };
  assert.equal(leaveCost(r, 500_000), 1_312_000);
  assert.equal(leaveCost({ ...r, gap_keeps_paying: false }, 500_000), 1_100_000);
});
