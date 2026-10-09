import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBeijingBenefit } from '../src/plan-pension-policy.ts';

const source = { basis: 'assumption', source: '明确虚构假设，不是个人资料' };
const fixture = (over = {}) => ({
  scope: 'beijing-enterprise-post-1998', birth_month: '1990-01', worker: 'male', flex_months: 0,
  paid_months_at_retirement: 276,
  average_index: { ten_thousandths: 9200, ...source },
  benefit_base: { cents: '1204900', year: 2053, ...source },
  account_at_retirement: { cents: '11700000', ...source },
  disbursement: { months: 117, basis: 'verified', source: '国发〔2005〕38号整岁表' },
  ...over,
});
const ready = input => { const r = calculateBeijingBenefit(input); assert.equal(r.status, 'ready', JSON.stringify(r)); return r.value; };

test('explicit index, benefit base and account yield independently calculated components', () => {
  const r = ready(fixture());
  assert.deepEqual([r.base_monthly_cents, r.account_monthly_cents, r.total_monthly_cents], [266042, 100000, 366042]);
  assert.deepEqual([r.retirement_month, r.scheduled_payment_month, r.payable_from_month], ['2053-01', '2053-02', '2053-02']);
  assert.equal(r.payable_monthly_cents, 366042);
  assert.equal(ready(fixture({ average_index: { ten_thousandths: 10000, ...source } })).base_monthly_cents, 277127);
});

test('2025 dated official base and whole-age table reproduce closed-form benefit', () => {
  const r = ready(fixture({ birth_month: '1965-01', flex_months: -1, paid_months_at_retirement: 240,
    average_index: { ten_thousandths: 10000, ...source }, benefit_base: { cents: '1204900', year: 2025, basis: 'verified', source: '京人社发〔2025〕13号' },
    account_at_retirement: { cents: '13900000', ...source }, disbursement: { months: 139, basis: 'verified', source: '整岁表' } }));
  assert.equal(r.total_monthly_cents, 340980);
  assert.equal(r.scheduled_payment_month, '2025-02');
});

test('years round to two decimals for amounts, but contribution eligibility uses exact months', () => {
  const r = ready(fixture({ paid_months_at_retirement: 241, average_index: { ten_thousandths: 10000, ...source } }));
  assert.equal(r.contribution_years, 20.08);
  assert.equal(r.base_monthly_cents, 241944);
  const short = ready(fixture({ paid_months_at_retirement: 239 }));
  assert.equal(short.eligible, false); assert.equal(short.short_months, 1);
  assert.equal(short.payable_monthly_cents, 0); assert.equal(short.payable_from_month, null);
  assert.ok(short.total_monthly_cents > 0);
});

test('zero and low historical indices remain explicit values, never clamped to 0.6', () => {
  assert.equal(ready(fixture({ average_index: { ten_thousandths: 4000, ...source }, paid_months_at_retirement: 240 })).base_monthly_cents, 168686);
  const zero = ready(fixture({ paid_months_at_retirement: 0, average_index: { ten_thousandths: 0, ...source }, account_at_retirement: { cents: '0', ...source } }));
  assert.equal(zero.total_monthly_cents, 0); assert.equal(zero.eligible, false);
});

test('each missing input blocks without leaking a zero answer', () => {
  for (const key of Object.keys(fixture())) {
    const result = calculateBeijingBenefit(fixture({ [key]: null }));
    assert.equal(result.status, 'blocked', key);
    assert.ok(result.issues.some(i => i.kind === 'missing' && i.field === key), key);
    assert.equal('value' in result, false);
  }
});

test('invalid values and contradictory dated policy data are rejected, not clamped', () => {
  const invalid = [
    { birth_month: '1990-13' }, { worker: 'programmer' }, { flex_months: 37 }, { flex_months: .5 },
    { paid_months_at_retirement: -1 }, { paid_months_at_retirement: 240.5 }, { paid_months_at_retirement: NaN },
    { paid_months_at_retirement: 900 },
    { average_index: { ten_thousandths: -1, ...source } }, { average_index: { ten_thousandths: 9200.5, ...source } },
    { benefit_base: { cents: '12049.00', year: 2053, ...source } }, { benefit_base: { cents: '0', year: 2053, ...source } },
    { benefit_base: { cents: '1204900', year: 2025, ...source } }, { account_at_retirement: { cents: '-1', ...source } },
    { disbursement: { months: 139, basis: 'verified', source: '不符63岁' } },
    { disbursement: { months: 0, ...source } }, { disbursement: { months: Infinity, ...source } },
    { average_index: { ten_thousandths: 9200, basis: 'verified', source: '' } },
  ];
  for (const over of invalid) assert.equal(calculateBeijingBenefit(fixture(over)).status, 'blocked', JSON.stringify(over));
});

test('scope and pre-reform retirees stay unsupported; fractional ages require a disclosed assumption', () => {
  for (const over of [{ scope: 'other' }, { birth_month: '1964-12' }]) {
    assert.ok(calculateBeijingBenefit(fixture(over)).issues.some(i => i.kind === 'unsupported'));
  }
  const p = fixture({ birth_month: '1970-01', flex_months: 36, benefit_base: { cents: '1204900', year: 2034, ...source } });
  assert.ok(calculateBeijingBenefit(p).issues.some(i => i.field === 'disbursement'));
  const r = ready({ ...p, disbursement: { months: 106, ...source } });
  assert.deepEqual([r.retirement_month, r.required_year, r.required_months], ['2034-05', 2031, 192]);
});

test('December retirement pays in next January without moving retirement or inventing a pool unlock', () => {
  const r = ready(fixture({ birth_month: '1990-12' }));
  assert.deepEqual([r.retirement_month, r.scheduled_payment_month], ['2053-12', '2054-01']);
  assert.equal('unlock_age_months' in r, false);
});

test('input and returned provenance are independent; output identifies assumptions', () => {
  const p = fixture(), before = structuredClone(p), r = ready(p);
  assert.deepEqual(p, before);
  assert.equal(r.sources.average_index.basis, 'assumption');
  r.sources.average_index.source = 'changed';
  assert.deepEqual(p, before);
});

test('cent ties round each component before summing; unsafe money never becomes a numeric answer', () => {
  const r = ready(fixture({ average_index: { ten_thousandths: 0, ...source }, paid_months_at_retirement: 240,
    benefit_base: { cents: '5', year: 2053, ...source }, account_at_retirement: { cents: '1', ...source },
    disbursement: { months: 2, ...source } }));
  assert.deepEqual([r.base_monthly_cents, r.account_monthly_cents, r.total_monthly_cents], [1, 1, 2]);
  const result = calculateBeijingBenefit(fixture({ benefit_base: { cents: '9007199254740991', year: 2053, ...source }, average_index: { ten_thousandths: 9007199254740991, ...source } }));
  assert.equal(result.status, 'blocked');
});
