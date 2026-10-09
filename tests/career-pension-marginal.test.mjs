import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources } from '../src/career-preview/fixtures.ts';
import { careerPensionSources } from '../src/career-preview/pension-fixture.ts';
import { marginalPension } from '../src/career-preview/pension-marginal.ts';

// Fictional profile: male born 1994-10, 200 paid months, base 10000. The minimum contribution years at his statutory
// retirement are 20 (240 months), so stopping now leaves him 40 months short and no monthly basic pension at all.
const floor = '727000';
const run = (months, base = floor, cash = null, s = careerPensionSources()) => marginalPension(s, { months, base_cents: base, cash_cents: cash });

test('stopping now is short of the minimum years; a few more months narrow the gap without changing the payable pension', () => {
  const r = run(12);
  assert.equal(r.status, 'ready');
  assert.equal(r.stopped.short_months, 40); assert.equal(r.stopped.eligible, false); assert.equal(r.stopped.monthly_cents, 0);
  assert.equal(r.paying.short_months, 28); assert.equal(r.paying.eligible, false);
  assert.equal(r.delta_monthly_cents, 0, 'still no payable monthly pension, the formula amount is not shown as payable');
});

test('crossing the minimum years is a cliff: the gain includes going from nothing to a monthly pension', () => {
  const r = run(48);
  assert.equal(r.paying.short_months, 0); assert.equal(r.paying.eligible, true);
  assert.ok(r.delta_monthly_cents > 0 && r.delta_monthly_cents === r.paying.monthly_cents);
  const more = run(96), longer = run(60);
  assert.ok(more.delta_monthly_cents > run(60).delta_monthly_cents && longer.delta_monthly_cents >= r.delta_monthly_cents, 'more paid months never lower the pension');
});

test('a higher base buys at least as much, and payback needs a bill amount and a real gain', () => {
  const low = run(96, floor), high = run(96, '1000000');
  assert.ok(high.delta_monthly_cents >= low.delta_monthly_cents);
  assert.equal(low.cash_total_cents, null); assert.equal(low.payback_years, null);
  const withCash = run(96, floor, '200000');
  assert.equal(withCash.cash_total_cents, withCash.paying.contribution_months * 200000);
  assert.ok(Math.abs(withCash.payback_years - withCash.cash_total_cents / (withCash.delta_monthly_cents * 12)) < 1e-9);
  const noGain = run(12, floor, '200000'); assert.equal(noGain.payback_years, null, 'no pension gain, no payback');
});

test('blocked, not guessed: incomplete profile, bad months, base outside the limits', () => {
  assert.equal(run(12, floor, null, careerSources()).status, 'blocked');
  for (const m of [0, 1.5, 601]) assert.equal(run(m).status, 'blocked');
  assert.equal(run(12, '100').status, 'blocked'); assert.equal(run(12, '99999999').status, 'blocked'); assert.equal(run(12, '').status, 'blocked');
});

test('the calculation reads the facts and changes nothing', () => {
  const s = careerPensionSources(), before = structuredClone(s);
  run(48, floor, '200000', s); assert.deepEqual(s, before);
});
