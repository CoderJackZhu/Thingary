import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceCareer, referenceMaxGap } from './helpers/career-reference.mjs';
import { inputs } from './helpers/career-benchmark.mjs';
import { evaluateCareerScenario } from '../src/plan-career.ts';
import { maxGap } from '../src/plan-career-map.ts';

// Differential test: randomly drawn fictional scenarios (fixed seed) on the oracle's timeline, engine versus the
// independent month-by-month ledger. Covers returns, inflation, gap length, self-paid insurance (included or extra),
// gap income and one-off severance. Scope is the oracle's: closed start, one change, manual or no pension.
let seed = 20261009;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a, b, step = 1) => a + Math.floor(rnd() * ((b - a) / step + 1)) * step;
const draw = () => ({
  start: pick(2_000_000, 150_000_000, 100_000), current: pick(500_000, 3_000_000, 50_000), gap: pick(0, 36), spend: pick(600_000, 1_500_000, 50_000),
  income: rnd() < .5 ? 0 : pick(50_000, 400_000, 50_000), recovery: pick(0, 1_500_000, 50_000),
  beforeRate: rnd() < .4 ? 0 : pick(0, 40, 5) / 1000, afterRate: rnd() < .4 ? 0 : pick(0, 30, 5) / 1000, inflation: rnd() < .5 ? 0 : pick(0, 30, 5) / 1000,
  gapInsurance: rnd() < .5 ? 0 : pick(100_000, 300_000, 50_000), gapIncluded: rnd() < .5, lump: rnd() < .3 ? pick(1_000_000, 20_000_000, 500_000) : 0,
});
const build = o => { const x = inputs(o); x.s.profile.value.saved.profile.retire.basic.contribution.monthly_cents = String(o.current); return x; };

test('60 random scenarios: goal assets and the discounted retirement requirement match the independent ledger to the cent', () => {
  for (let i = 0; i < 60; i++) {
    const o = draw(), { s, d } = build(o), res = evaluateCareerScenario(s, d), ref = referenceCareer(o);
    assert.equal(res.prediction.status, 'ready', JSON.stringify(o));
    const v = res.prediction.value;
    assert.ok(Math.abs(v.outcome.assets_at_goal - ref.assets) < 0.05, `assets ${i} ${JSON.stringify(o)}`);
    assert.ok(Math.abs(v.outcome.required_at_goal - ref.required) < 0.05, `required ${i} ${JSON.stringify(o)}`);
  }
});

test('16 random scenarios: the longest feasible gap equals the oracle brute force', () => {
  for (let i = 0; i < 16; i++) {
    const o = draw(), { s, d } = build(o), mine = maxGap(s, d), oracle = referenceMaxGap(o);
    assert.equal(mine.status === 'found' ? mine.months : null, oracle, JSON.stringify(o));
  }
});
