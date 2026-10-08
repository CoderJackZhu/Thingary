import test from 'node:test';
import assert from 'node:assert/strict';
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
const saved = retire => ({ revision: 1, updated_at: TODAY, profile: { ...profile, region: 'beijing', assumptions: defaultAssumptions, overrides: noOverrides, retire: { ...defaultRetire, core: { contract_version: 1, monetary_basis_date: '2026-10-06', fund_rules: [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }], hpf_monthly_cents: '0', occurrences: [] }, saving_phases: [{ id: 'default-explicit', label: '显式测试假设', from_age_months: 0, monthly_cents: 1000000 }], spend_cents: '500000', ...retire } } });
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
