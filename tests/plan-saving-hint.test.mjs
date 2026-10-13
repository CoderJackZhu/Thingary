import test from 'node:test';
import assert from 'node:assert/strict';
import * as hint from '../src/plan-saving-hint.ts';

const review = (cash, extra = {}) => ({ generation: 'g', intervals: [], incomplete_count: 0, stats: { count: 5, low_sample: false, median_monthly_saving_cents: null, mean_monthly_saving_cents: null, median_monthly_spend_cents: null, median_monthly_cash_saving_cents: cash, window_from: '2025-11-01', latest_date: '2026-10-13', ...extra } });
const yuan = n => String(n * 100);

test('a large gap in both money and proportion produces a hint in either direction', () => {
  const lower = hint.savingHint(review(yuan(3500)), yuan(5000));
  assert.deepEqual([lower.direction, lower.historical_cents, lower.entered_cents, lower.count], ['lower', yuan(3500), yuan(5000), 5]);
  assert.equal(hint.savingHint(review(yuan(8000)), yuan(5000)).direction, 'higher');
  assert.equal(hint.savingHint(review(yuan(-500)), yuan(2000)).direction, 'lower');
});

test('small or proportionally minor gaps stay quiet', () => {
  assert.equal(hint.savingHint(review(yuan(4600)), yuan(5000)), null, 'under ¥1,000');
  assert.equal(hint.savingHint(review(yuan(15000)), yuan(16500)), null, 'over ¥1,000 but under 25%');
  assert.equal(hint.savingHint(review(yuan(4000)), yuan(5000)), null, '¥1,000 is only 20%');
  assert.notEqual(hint.savingHint(review(yuan(3750)), yuan(5000)), null, 'exactly 25% and above ¥1,000 is enough');
});

test('unknowns never produce a hint', () => {
  assert.equal(hint.savingHint(null, yuan(5000)), null);
  assert.equal(hint.savingHint(review(yuan(3000)), null), null, 'no entered estimate');
  assert.equal(hint.savingHint(review(null), yuan(5000)), null, 'no estimate from history');
  assert.equal(hint.savingHint(review(yuan(3000), { low_sample: true, count: 2 }), yuan(5000)), null, 'fewer than three intervals');
  assert.equal(hint.savingHint(review(yuan(3000), { latest_date: null }), yuan(5000)), null);
});

test('dismissal holds until the next check-in changes the statistics', () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const h = hint.savingHint(review(yuan(3000)), yuan(5000));
  assert.equal(hint.savingHintDismissed(storage, 'g', h), false);
  hint.dismissSavingHint(storage, 'g', h);
  assert.equal(hint.savingHintDismissed(storage, 'g', h), true);
  assert.equal(hint.savingHintDismissed(storage, 'other-library', h), false);
  assert.equal(hint.savingHintDismissed(storage, 'g', { ...h, latest_date: '2026-11-13' }), false);
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(hint.savingHintDismissed(broken, 'g', h), false);
  assert.doesNotThrow(() => hint.dismissSavingHint(broken, 'g', h));
  assert.equal(hint.savingHintDismissed(null, 'g', h), false);
});
