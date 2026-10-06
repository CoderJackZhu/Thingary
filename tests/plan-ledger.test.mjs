import test from 'node:test';
import assert from 'node:assert/strict';
import { coastAmount, coastAt, coverageAt, glide, nominalFactor, outcome, project, required, savingsOf, scaleSaving, scaleSpend } from '../src/plan-ledger.ts';
import { findFire, requiredAssets, traditional } from './legacy-fire.ts';

const none = () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 });
const living = (over = {}) => ({ id: 'living', label: '生活', monthly_cents: 1000, start_age: null, end_age: null, inflation_hundredths: null, essential: true, ...over });
const plan = (over = {}) => ({
  now_months: 360, horizon_months: 1080, search_cap_months: 840, target_months: 360, mode: 'fire', assets_cents: 0,
  saving_cents: 1000, saving_growth_hundredths: 0, r_before_hundredths: 0, r_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500,
  items: [living()], incomes: [], pension_at: none, spends: [], ...over,
});
const old = (P) => ({ now_months: P.now_months, horizon_months: P.horizon_months, search_cap_months: P.search_cap_months, spend_cents: 1000, assets_cents: P.assets_cents, pension_at: P.pension_at });
const withPension = () => ({ monthly_cents: 400, lump_cents: 5000, unlock_age_months: 756 });

test('one bucket and no income: required assets and FIRE month match the single-budget engine', () => {
  for (const r of [0, 150, 300]) for (const pension_at of [none, withPension]) {
    const P = plan({ r_before_hundredths: r, r_after_hundredths: r, pension_at, assets_cents: 20_000 });
    for (const a of [360, 500, 720, 900]) assert.ok(Math.abs(required(P, a) - requiredAssets(old(P), a, r)) < 1e-6, `age ${a} r ${r}`);
    const proj = project(P, 2026), fire = findFire(old(P), 1000, r, r);
    assert.equal(proj.fi_month === null ? null : proj.fi_month - 360, fire?.offset_months ?? null);
  }
});

test('traditional mode: assets at the target and the surplus match the single-budget engine', () => {
  const P = plan({ mode: 'traditional', target_months: 756, assets_cents: 5000, pension_at: withPension, r_before_hundredths: 100, r_after_hundredths: 100 });
  const proj = project(P, 2026), o = outcome(P, proj), t = traditional(old(P), 756, 1000, 100, 100);
  assert.ok(Math.abs(o.assets_at_goal - t.assets_cents) < 1e-6);
  assert.ok(Math.abs(o.required_at_goal - t.required_cents) < 1e-6);
  assert.equal(proj.retire_month, 756);
});

test('a bucket with an age window only counts inside it; own inflation raises the real amount', () => {
  const P = plan({ items: [living({ monthly_cents: 600 }), living({ id: 'trip', monthly_cents: 400, start_age: 65, end_age: 70 })], pension_at: none });
  // 60 岁退休（720）：每月 600 共 360 个月，旅行 780–840 月龄每月 400 共 60 个月。
  assert.equal(required(P, 720), 600 * 360 + 400 * 60);
  const healthcare = plan({ items: [living({ monthly_cents: 1000, inflation_hundredths: 400 })] });
  const g = 1.04 / 1.02;
  let sum = 0;
  for (let i = 360; i < 1080; i++) if (i >= 720) sum += 1000 * g ** (i / 12 - 30);
  // 实际增长从今天起算：第 i 个月（距今 i-360 个月）的金额 = 1000 · g^((i-360)/12)
  sum = 0;
  for (let i = 720; i < 1080; i++) sum += 1000 * g ** ((i - 360) / 12);
  assert.ok(Math.abs(required(healthcare, 720) - sum) < 1e-6);
  assert.ok(required(healthcare, 720) > required(plan(), 720));
});

test('income streams reduce the need; a fixed nominal stream is worth less than an indexed one', () => {
  const stream = (indexed) => plan({ incomes: [{ id: 's', label: '年金', monthly_cents: 300, start_age: 65, end_age: null, indexed }] });
  assert.equal(required(stream(true), 720), 1000 * 360 - 300 * (1080 - 780));
  assert.ok(required(stream(false), 720) > required(stream(true), 720));
  assert.ok(required(stream(false), 720) < required(plan(), 720));
});

test('a large unlock early on does not hide the shortfall before it arrives', () => {
  // 退休当月就没有养老金，3 个月后解锁 1,000,000：前两个月的支出必须自己有，第 3 个月的支出与解锁同时发生。
  const P = plan({ horizon_months: 400, now_months: 360, pension_at: () => ({ monthly_cents: 0, lump_cents: 1_000_000, unlock_age_months: 363 }) });
  assert.equal(required(P, 360), 2000);
});

test('rows conserve money at zero return and a plan funded exactly to its requirement ends at zero', () => {
  const P0 = plan({ pension_at: withPension, target_months: 720, assets_cents: 50_000 });
  const proj = project(P0, 2026);
  for (const r of proj.rows) assert.ok(Math.abs(r.end - (r.start + r.contribution + r.unlock + r.income - r.spend + r.unfunded)) < 1e-6, `row ${r.k}`);
  const P = plan({ pension_at: withPension, target_months: 360 });
  const funded = { ...P, assets_cents: required(P, 360) };
  const p2 = project(funded, 2026);
  assert.equal(p2.retire_month, 360);
  assert.equal(p2.reason, 'funded');
  assert.ok(Math.abs(p2.assets[p2.assets.length - 1]) < 1e-5);
  assert.equal(p2.failure_month, null);
  assert.equal(outcome(funded, p2).success, true);
});

test('traditional mode retires on schedule even when underfunded and reports where money runs out', () => {
  const P = plan({ mode: 'traditional', target_months: 600, assets_cents: 1000, saving_cents: 0 });
  const proj = project(P, 2026), o = outcome(P, proj);
  assert.equal(proj.retire_month, 600);
  assert.equal(proj.reason, 'target_forced');
  assert.equal(proj.funded_at_retire, false);
  assert.equal(proj.failure_month, 601);
  assert.ok(proj.shortfall_month !== null && o.success === false && o.shortfall_at_goal > 0);
});

test('FIRE does not retire before the target age even when funded earlier, and never retires if never funded', () => {
  const early = plan({ assets_cents: 10_000_000, target_months: 600 });
  const p = project(early, 2026);
  assert.equal(p.fi_month, 360);
  assert.equal(p.retire_month, 600);
  const never = project(plan({ assets_cents: 0, saving_cents: 0 }), 2026);
  assert.deepEqual([never.fi_month, never.retire_month, never.rows.every(r => r.phase === 'accumulation')], [null, null, true]);
});

test('glide path reaches the goal requirement when followed, and coast amount grows into it', () => {
  const P = plan({ r_before_hundredths: 300, r_after_hundredths: 100, target_months: 600, assets_cents: 0, saving_cents: 500 });
  const g = glide(P, project(P, 2026));
  const start = { ...P, assets_cents: g[0] };
  const proj = project(start, 2026);
  assert.ok(Math.abs(proj.assets[600 - 360] - required(P, 600)) < 1e-4);
  const coast = coastAmount(P);
  assert.ok(Math.abs(coast * (1 + 0.03) ** ((600 - 360) / 12) - required(P, 600)) < 1e-4);
});

test('lean and fat scale the requirement; nominal factor is compound inflation', () => {
  const P = plan();
  assert.ok(Math.abs(required(scaleSpend(P, 0.7), 720) - 0.7 * required(P, 720)) < 1e-6);
  assert.ok(Math.abs(required(scaleSpend(P, 1.5), 720) - 1.5 * required(P, 720)) < 1e-6);
  assert.ok(Math.abs(nominalFactor(P, 360 + 120) - 1.02 ** 10) < 1e-12);
});

test('coverage splits a month into income, pension, portfolio withdrawal and the unfunded part', () => {
  const P = plan({ assets_cents: 100_000, target_months: 360, pension_at: () => ({ monthly_cents: 300, lump_cents: 0, unlock_age_months: 756 }), incomes: [{ id: 's', label: '年金', monthly_cents: 200, start_age: 60, end_age: null, indexed: true }] });
  const proj = project(P, 2026);
  const early = coverageAt(P, proj, 400), late = coverageAt(P, proj, 800);
  assert.deepEqual([early.spend, early.pension, early.items[0].active], [1000, 0, false]);
  assert.deepEqual([late.pension, late.items[0].monthly, Math.round(late.withdrawal)], [300, 200, 500]);
});

test('saving phases: each month follows its phase; negative phases draw down but never below zero; scaling spares the negatives', () => {
  const P = plan({ target_months: 2000, mode: 'traditional', assets_cents: 3000, saving_cents: 0, saving_phases: [{ from_month: 360, cents: -1000 }, { from_month: 364, cents: 500 }, { from_month: 372, cents: 800 }] });
  const s = savingsOf(P);
  assert.deepEqual([s[0], s[3], s[4], s[11], s[12], s[100]], [-1000, -1000, 500, 500, 800, 800]);
  const proj = project(P, 2026);
  assert.deepEqual(Array.from(proj.assets.slice(0, 6)), [3000, 2000, 1000, 0, 0, 500]);
  const scaled = scaleSaving(P, 2).saving_phases.map(p => p.cents);
  assert.deepEqual(scaled, [-1000, 1000, 1600]);
});

test('coast checkpoint: the balance needed at a month grows into the goal requirement with no more saving', () => {
  const P = plan({ r_before_hundredths: 300, target_months: 600 });
  assert.ok(Math.abs(coastAt(P, 480) * (1.03) ** ((600 - 480) / 12) - required(P, 600)) < 1e-4);
  assert.equal(coastAt(P, 360), coastAmount(P));
  assert.equal(coastAt(P, 700), required(P, 600));
});
