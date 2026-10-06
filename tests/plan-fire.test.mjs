import test from 'node:test';
import assert from 'node:assert/strict';
import { emergency, monthsLeftText, pensionTable, progressHundredths } from '../src/plan-fire.ts';
import { project } from '../src/plan-ledger.ts';
import { beijing } from '../src/plan-params.ts';

const none = () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 });

test('emergency line compares assets with months of spending', () => {
  assert.deepEqual(emergency(5000, 1000, 6), { covered_months: 5, below: true });
  assert.deepEqual(emergency(6000, 1000, 6), { covered_months: 6, below: false });
  assert.deepEqual(emergency(1, 0, 6), { covered_months: null, below: false });
});

test('pension table built from the pension calculator: retiring later is better, and the result is cached', () => {
  const profile = {
    birth_month: '1990-06', worker: 'male', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0,
    personal_pension_annual_cents: '1200000', marginal_tax_hundredths: 1000,
    assumptions: { inflation_hundredths: 200, wage_growth_hundredths: 200, pp_return_hundredths: 200 },
  };
  const funds = { hpf_balance_cents: '5500000', hpf_monthly_cents: '300000' };
  const at = pensionTable(profile, beijing, '2026-10-06', funds, 436, 756);
  const early = at(480), late = at(756);
  assert.ok(early.monthly_cents < late.monthly_cents && early.lump_cents < late.lump_cents);
  assert.equal(early.unlock_age_months, 756);
  assert.equal(at(900).unlock_age_months, 900, 'quitting after the start age unlocks at the quit age');
  assert.equal(at(480), early, 'cached object');
  // 用它推出一个 FIRE 日期：有养老金与公积金，比没有时早或相同。
  const base = { now_months: 436, horizon_months: 1080, search_cap_months: 840, target_months: 436, mode: 'fire', assets_cents: 30_000_000, saving_cents: 600_000, saving_growth_hundredths: 0, r_before_hundredths: 0, r_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 0, items: [{ id: 'l', label: '生活', monthly_cents: 800_000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }], incomes: [], spends: [] };
  const withFunds = project({ ...base, pension_at: at }, 2026), without = project({ ...base, pension_at: none }, 2026);
  assert.ok(withFunds.fi_month <= without.fi_month);
});

test('goal progress and time-left wording', () => {
  assert.deepEqual([[295, 1000], [0, 1000], [2000, 1000], [5, 0], [-50, 1000]].map(([a, r]) => progressHundredths(a, r)), [2950, 0, 10000, 10000, 0]);
  assert.deepEqual([0, -3, 1, 11, 12, 13, 24, 148].map(monthsLeftText), ['已经够了', '已经够了', '1 个月', '11 个月', '1 年', '1 年 1 个月', '2 年', '12 年 4 个月']);
});

test('pension table: not enough contribution years means no monthly pension, but the personal account balance comes back as a lump sum', () => {
  const profile = {
    birth_month: '1990-06', worker: 'male', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0,
    personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000,
    assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 },
  };
  const funds = { hpf_balance_cents: '0', hpf_monthly_cents: '0' };
  const at = pensionTable(profile, { ...beijing, notional_rate_hundredths: 0, hpf_rate_hundredths: 0 }, '2026-10-06', funds, 436, 756);
  const short = at(480), enough = at(756);
  assert.deepEqual([short.eligible, short.monthly_cents], [false, 0]);
  assert.ok(short.short_months > 0);
  assert.ok(short.lump_cents >= 5_000_000, 'the account balance is paid back');
  assert.deepEqual([enough.eligible, enough.short_months], [true, 0]);
  assert.ok(enough.monthly_cents > 0 && enough.lump_cents === 0);
});
