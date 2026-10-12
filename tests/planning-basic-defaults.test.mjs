import test from 'node:test';
import assert from 'node:assert/strict';
import { historyHints, savingFromFlow } from '../src/planning-basic-defaults.ts';
import { basicInput, draftOf, contributionSection } from '../src/planning-basic-forms.ts';
import { defaultRetire } from '../src/plan.ts';

const today = '2026-10-07';
const stats = (o = {}) => ({ review: { stats: { count: 4, low_sample: false, median_monthly_saving_cents: '300000', mean_monthly_saving_cents: '310000', median_monthly_spend_cents: '650000', window_from: '2025-10-01', latest_date: '2026-09-30', ...o }, intervals: [], incomplete_count: 0, generation: 'g' } });

test('history hints: median of at least 3 usual intervals; fewer or none gives nothing, never zero', () => {
  const ok = historyHints(stats().review);
  assert.equal(ok.saving, '300000'); assert.equal(ok.spend, '650000'); assert.equal(ok.count, 4);
  const two = historyHints(stats({ count: 2 }).review);
  assert.equal(two.saving, null); assert.equal(two.spend, null); assert.match(two.reason, /只有 2 个/);
  assert.equal(historyHints(stats({ count: 0, median_monthly_saving_cents: null }).review).saving, null);
  assert.equal(historyHints(null).saving, null);
  // Negative savings are real information, not "unknown".
  assert.equal(historyHints(stats({ median_monthly_saving_cents: '-50000' }).review).saving, '-50000');
  // A non-positive spend is not offered as a retirement budget.
  assert.equal(historyHints(stats({ median_monthly_spend_cents: '-10' }).review).spend, null);
});

test('income minus spend: blank is unknown, difference may be negative', () => {
  assert.equal(savingFromFlow('1000000', '600000'), '400000');
  assert.equal(savingFromFlow('500000', '800000'), '-300000');
  assert.equal(savingFromFlow('', '600000'), null);
});

test('history prefers cash-only figures and reports the investment change beside them, never inside', async () => {
  const withCash = stats({ median_monthly_cash_saving_cents: '120000', median_monthly_cash_spend_cents: '700000', median_monthly_market_change_cents: '250000' }).review;
  const h = historyHints(withCash);
  assert.equal(h.saving, '120000'); assert.equal(h.spend, '700000'); assert.equal(h.market, '250000');
  // No investment accounts (or no change): nothing to report.
  assert.equal(historyHints(stats({ median_monthly_market_change_cents: '0' }).review).market, null);
  // Older review data without the cash fields falls back to the mixed ones.
  assert.equal(historyHints(stats().review).saving, '300000');

  const { computeReview } = await import('../src/plan.ts');
  const point = (id, date, from, change, market) => ({ snapshot_id: id, date, notes: '', assets_cents: '0', liabilities_cents: '0', net_cents: '0', complete: true, missing: 0, compared_to: from, scope_changed: false, change_cents: change, hpf_change_cents: null, market_change_cents: market, change_rate_hundredths: null });
  const incomes = [{ id: 'i1', revision: 1, fields: { date: '2026-02-15', net_cents: '2000000', hpf_cents: '0', notes: '' } }, { id: 'i2', revision: 1, fields: { date: '2026-03-15', net_cents: '2000000', hpf_cents: '0', notes: '' } }];
  const r = computeReview([point('a', '2026-01-31', null, null, null), point('b', '2026-03-31', '2026-01-31', '3000000', '2000000')], incomes, new Set(), 'g');
  const i = r.intervals[0];
  // Same arithmetic as the Rust side: 59 days, 30.4375-day months.
  assert.equal(i.monthly_saving_cents, '1547669'); assert.equal(i.monthly_cash_saving_cents, '515890');
  assert.equal(i.monthly_spend_cents, '515890'); assert.equal(i.monthly_cash_spend_cents, '1547669');
  assert.equal(r.stats.median_monthly_market_change_cents, '1031780');
});

test('goal wording says whether the money is enough at the target age, not only at the end of the plan', async () => {
  const { goalFitText } = await import('../src/planning-basic-view.ts');
  const fmt = c => `¥${c}`;
  assert.equal(goalFitText({ funded_at_goal: true, shortfall_at_goal: 0 }, fmt), '到目标年龄时资金已够用');
  assert.match(goalFitText({ funded_at_goal: false, shortfall_at_goal: 123456.4 }, fmt), /还差 ¥123456，要更晚退休才够/);
});

test('historical spend requires its own three valid samples, saving keeps its original sample semantics',()=>{
 const two=historyHints(stats({spend_count:2}).review);assert.equal(two.saving,'300000');assert.equal(two.spend,null);assert.equal(two.count,4);assert.equal(two.spend_count,2);
 const three=historyHints(stats({spend_count:3}).review);assert.equal(three.spend,'650000');assert.equal(three.spend_count,3);
});
