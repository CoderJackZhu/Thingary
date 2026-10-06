import test from 'node:test';
import assert from 'node:assert/strict';
import { blankRent, fieldsToRent, oneMonthBefore, rentPreview, rentToFields } from '../src/rent-plan.ts';
import { scheduleDates } from '../src/recurring-model.ts';

const rent = over => ({ amount_cents: '840000', interval_months: 3, start: '2025-07-06', advance_days: 30, end: '2026-07-06', ...over });
const planOf = (r, extra = {}) => ({ fields: { name: '房租', notes: '', ...rentToFields(r) }, rules: [], period_ends: {}, special_start: null, special_end: null, renewal_cents: null, ...extra });

test('a one-year quarterly lease is four periods, whether the end is 07-06 or 07-05', () => {
  for (const end of ['2026-07-06', '2026-07-05']) {
    const p = rentPreview(rent({ end }), '2026-10-06');
    assert.equal(p.rows.length, 4, end);
    assert.equal(p.total_cents, 3_360_000n);
    assert.equal(p.monthly_cents, 280_000n);
  }
  const p = rentPreview(rent(), '2026-10-06');
  assert.deepEqual(p.rows.map(r => [r.due, r.from, r.to]), [
    ['2025-06-06', '2025-07-06', '2025-10-05'], ['2025-09-06', '2025-10-06', '2026-01-05'],
    ['2025-12-06', '2026-01-06', '2026-04-05'], ['2026-03-06', '2026-04-06', '2026-07-05'],
  ]);
});

test('monthly rent paid in advance: 10 Oct pays for the next month', () => {
  // 每月、提前 26 天：11 月 1 日起的一期在 10 月 6 日付；这里用「提前几天」表达。
  // 租期 2026-11-06 到 2027-01-06（不含）：两个月，第三期 1 月 6 日起已不在租期内。
  const p = rentPreview(rent({ amount_cents: '280000', interval_months: 1, start: '2026-11-06', advance_days: 27, end: '2027-01-06' }), '2026-10-06');
  assert.deepEqual(p.rows.map(r => [r.due, r.from, r.to]), [['2026-10-10', '2026-11-06', '2026-12-05'], ['2026-11-10', '2026-12-06', '2027-01-05']]);
  assert.equal(p.total_cents, 560_000n);
});

test('open-ended rent lists up to two periods past today and says it keeps renewing', () => {
  const p = rentPreview(rent({ end: '', interval_months: 1, amount_cents: '280000', start: '2026-09-06', advance_days: 20 }), '2026-10-06');
  assert.equal(p.open_ended, true);
  assert.ok(p.rows.length >= 3 && p.rows.length <= 5);
  assert.ok(p.rows.at(-1).due > '2026-10-06');
});

test('mapping to plan fields: end date is stored as the last day of use, one day before the expiry', () => {
  const f = rentToFields(rent());
  assert.deepEqual([f.first_due, f.service_start, f.coverage_start, f.end_date, f.category, f.interval_months], ['2025-06-06', '2025-07-06', '2025-07-06', '2026-07-05', 'rent', 3]);
  assert.equal(rentToFields(rent({ end: '' })).end_date, null);
  // 与应用自己的排期算法一致：4 期，没有只剩一天的第五期。
  assert.deepEqual(scheduleDates({ ...planOf(rent()).fields }, '2025-01-01', '2026-12-31'), ['2025-06-06', '2025-09-06', '2025-12-06', '2026-03-06']);
});

test('reading back: simple plans round trip, complex ones fall back to the full form', () => {
  const r = rent();
  assert.deepEqual(fieldsToRent(planOf(r)), r);
  assert.deepEqual(fieldsToRent(planOf(rent({ end: '', advance_days: 0 }))), rent({ end: '', advance_days: 0 }));
  const complex = [
    planOf(r, { rules: [{}, {}] }), planOf(r, { period_ends: { '2025-07-06': '2025-10-01' } }), planOf(r, { renewal_cents: '900000' }),
    { ...planOf(r), fields: { ...planOf(r).fields, interval_days: 30 } }, { ...planOf(r), fields: { ...planOf(r).fields, trial_days: 7 } },
    { ...planOf(r), fields: { ...planOf(r).fields, category: 'subscription' } }, { ...planOf(r), fields: { ...planOf(r).fields, coverage_start: '2025-07-20' } },
    { ...planOf(r), fields: { ...planOf(r).fields, interval_months: 2 } }, { ...planOf(r), fields: { ...planOf(r).fields, first_due: '2025-07-20' } },
  ];
  assert.deepEqual(complex.map(fieldsToRent), complex.map(() => null));
});

test('invalid input gives no preview; one month before follows the calendar', () => {
  assert.equal(rentPreview(rent({ start: '' }), '2026-10-06'), null);
  assert.equal(rentPreview(rent({ amount_cents: '' }), '2026-10-06'), null);
  assert.equal(rentPreview(rent({ end: '2025-07-06' }), '2026-10-06'), null);
  assert.deepEqual(['2026-11-06', '2026-03-31', '2026-03-01'].map(oneMonthBefore), [31, 31, 28]);
  assert.equal(blankRent('2026-10-06').end, '');
});
