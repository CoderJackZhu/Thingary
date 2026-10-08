import test from 'node:test';
import assert from 'node:assert/strict';
import { outcome, project, required } from '../src/plan-ledger.ts';
import { ageSpendingMatrix, contributionReturnMatrix, crashReturns, gapAt, largestRisk, monteCarlo, requiredSaving, saveFrom, seedOf, sorr, stressTests, stressSeverity, workSaving } from '../src/plan-risk.ts';

const pension = () => ({ monthly_cents: 300, lump_cents: 20_000, unlock_age_months: 756 });
const plan = (over = {}) => ({
  now_months: 360, horizon_months: 1080, search_cap_months: 840, target_months: 480, mode: 'fire', assets_cents: 50_000,
  saving_cents: 1500, saving_growth_hundredths: 0, r_before_hundredths: 200, r_after_hundredths: 100, inflation_hundredths: 200, volatility_hundredths: 0,
  items: [{ id: 'l', label: '生活', monthly_cents: 1000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }],
  incomes: [], pension_at: pension, spends: [], ...over,
});
const YEAR = 2026;

test('with no volatility every path is the deterministic projection', async () => {
  for (const mode of ['fire', 'traditional']) for (const assets of [50_000, 5_000_000, 0]) {
    const P = plan({ mode, assets_cents: assets }), proj = project(P, YEAR), o = outcome(P, proj);
    const mc = await monteCarlo(P, 20, { seed: 1 });
    assert.equal(mc.success_rate, o.success ? 1 : 0, `${mode} ${assets}`);
    assert.equal(mc.median_fi_month, proj.fi_month);
    assert.ok(Math.abs(mc.final.p50 - Math.max(0, o.at_horizon)) < 1e-6);
    assert.equal(mc.ages.length, mc.bands.p50.length);
    mc.bands.p50.forEach((v, j) => { if (j < proj.rows.length) assert.ok(Math.abs(v - Math.max(0, proj.rows[j].start)) < 1e-6, `row ${j}`); });
  }
});

test('market paths: percentiles are ordered, the seed makes runs repeatable, and the extremes are decided', async () => {
  const P = plan({ volatility_hundredths: 1200 });
  const a = await monteCarlo(P, 2000, { seed: seedOf(P) }), b = await monteCarlo(P, 2000, { seed: seedOf(P) });
  assert.deepEqual(a, b);
  for (let j = 0; j < a.ages.length; j++) { const { p10, p25, p50, p75, p90 } = a.bands; assert.ok(p10[j] <= p25[j] && p25[j] <= p50[j] && p50[j] <= p75[j] && p75[j] <= p90[j]); }
  assert.ok(a.success_rate > 0 && a.success_rate < 1);
  const rich = await monteCarlo(plan({ volatility_hundredths: 1200, assets_cents: 50_000_000 }), 500, { seed: 3 });
  assert.equal(rich.success_rate, 1);
  const broke = await monteCarlo(plan({ mode: 'traditional', volatility_hundredths: 1200, assets_cents: 0, saving_cents: 0 }), 500, { seed: 3 });
  assert.equal(broke.success_rate, 0);
  // 波动越大，较低结果越差、较高结果越好。
  const calm = await monteCarlo(plan({ volatility_hundredths: 200 }), 2000, { seed: 4 }), wild = await monteCarlo(plan({ volatility_hundredths: 2000 }), 2000, { seed: 4 });
  assert.ok(wild.final.p90 > calm.final.p90);
});

test('stress tests apply the documented shocks to the same engine', () => {
  const P = plan(), base = outcome(P, project(P, YEAR));
  const by = Object.fromEntries(stressTests(P, YEAR).map(r => [r.id, r]));
  assert.equal(Object.keys(by).length, 6);
  assert.deepEqual(by['return-drag'].stressed, outcome(...[{ ...P, r_before_hundredths: 0, r_after_hundredths: -100 }].flatMap(q => [q, project(q, YEAR)])));
  assert.equal(by['spending-shock'].stressed.required_at_goal > base.required_at_goal, true);
  assert.ok(Math.abs(by['spending-shock'].stressed.required_at_goal - required({ ...P, items: [{ ...P.items[0], monthly_cents: 1100 }] }, 480)) < 1e-6);
  assert.equal(by['save-less'].stressed.assets_at_goal < base.assets_at_goal, true);
  assert.deepEqual(by['retire-earlier'].stressed, outcome(...[{ ...P, target_months: 456 }].flatMap(q => [q, project(q, YEAR)])));
  const crash = outcome(P, project(P, YEAR, { after: crashReturns(P, { 0: -0.3 }) }));
  assert.deepEqual(by['early-crash'].stressed, crash);
  assert.ok(by['early-crash'].horizon_delta <= 0);
  for (const r of Object.values(by)) assert.ok(['low', 'medium', 'high'].includes(r.severity));
  // 通胀升高：实际收益降低，财务独立不会更早（期末余额在 FIRE 下可能因推迟退休而更多，所以不比它）。
  assert.ok(by['inflation-shock'].fi_delay_months === null || by['inflation-shock'].fi_delay_months >= 0);
  assert.ok(by['return-drag'].fi_delay_months === null || by['return-drag'].fi_delay_months >= 0);
});

test('the largest risk ranks by severity, then gap, then delay; nothing material gives null', () => {
  const o = { fi_month: 500, retire_month: 500, assets_at_goal: 0, required_at_goal: 1000, funded_at_goal: false, shortfall_at_goal: 100, at_horizon: 10, failure_month: null, shortfall_month: null, success: true };
  const r = (id, severity, gap, delay) => ({ id, label: id, description: '', baseline: o, stressed: o, fi_delay_months: delay, shortfall_delta: gap, horizon_delta: 0, severity });
  assert.equal(largestRisk([r('a', 'low', 5, 0), r('b', 'high', 1, 0), r('c', 'high', 9, 0)]).id, 'c');
  assert.equal(largestRisk([r('a', 'low', 0, 0), r('b', 'low', 0, 0)]), null);
});

test('matrices: the baseline cell is the base plan, more saving or more return never hurts, a later age never lowers the need', () => {
  const P = plan(), base = outcome(P, project(P, YEAR));
  const m = contributionReturnMatrix(P, YEAR);
  assert.deepEqual([m.rows.length, m.cols.length], [5, 5]);
  const c = m.cells[m.base_row][m.base_col];
  assert.deepEqual([c.fi_month, c.at_horizon], [base.fi_month, base.at_horizon]);
  for (const row of m.cells) for (let j = 1; j < row.length; j++) assert.ok((row[j].fi_month ?? Infinity) <= (row[j - 1].fi_month ?? Infinity));
  for (let i = 1; i < m.cells.length; i++) for (let j = 0; j < 5; j++) assert.ok((m.cells[i][j].fi_month ?? Infinity) <= (m.cells[i - 1][j].fi_month ?? Infinity));
  const a = ageSpendingMatrix(P, YEAR);
  assert.deepEqual([a.rows.length, a.cols.length], [5, 5]);
  assert.deepEqual(a.cols, [36, 38, 40, 42, 44]);
  const b = a.cells[a.base_row][a.base_col];
  assert.deepEqual([b.fi_month, b.at_horizon], [base.fi_month, base.at_horizon]);
  // 支出更高：FI 不会更早。
  for (let j = 0; j < 5; j++) for (let i = 1; i < 5; i++) assert.ok((a.cells[i][j].fi_month ?? Infinity) >= (a.cells[i - 1][j].fi_month ?? Infinity));
  // 明确零投入时，比较金额参照目标预算，仍保留零这个真实基准。
  assert.deepEqual(contributionReturnMatrix(plan({ saving_cents: 0 }), YEAR).cols, [0, 250, 500, 750, 1000]);
});

test('crash paths: base is the plan itself, shocks never leave more money, and an unfunded plan has none', () => {
  const P = plan({ assets_cents: 5_000_000 }), proj = project(P, YEAR);
  const paths = sorr(P, YEAR);
  assert.equal(paths.length, 3);
  const [base, early, late] = paths;
  assert.ok(Math.abs(base.final - Math.max(0, proj.assets[proj.assets.length - 1])) < 1e-6);
  assert.equal(base.path[0], early.path[0]);
  for (const p of [early, late]) assert.ok(p.final <= base.final + 1e-6, p.id);
  assert.ok(early.path[1] < base.path[1]);
  assert.equal(late.path[1], base.path[1]);
  assert.equal(sorr(plan({ assets_cents: 0, saving_cents: 0 }), YEAR), null);
});

test('severity follows actual loss of coverage rather than a delay or percentage threshold', () => {
  const covered = { ...outcome(plan(), project(plan(), YEAR)), success: true, funded_at_goal: true, fi_month: 500, failure_month: null, shortfall_month: null, shortfall_at_goal: 0, at_horizon: 1000 };
  assert.equal(stressSeverity(covered, { ...covered, success: false, failure_month: 800 }), 'high');
  assert.equal(stressSeverity(covered, { ...covered, fi_month: 548 }), 'medium');
  assert.equal(stressSeverity(covered, { ...covered, at_horizon: 2000 }), 'low');
  const failed = { ...covered, success: false, failure_month: 800 };
  assert.equal(stressSeverity(failed, { ...failed, failure_month: 850 }), 'low');
  assert.equal(stressSeverity(failed, { ...failed, failure_month: 799 }), 'high');
});

test('sequence comparison preserves the return product, including a partial final year', () => {
  const P = plan({ mode: 'traditional', now_months: 360, target_months: 360, horizon_months: 390, assets_cents: 10_000_000, items: [], incomes: [], pension_at: () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 }) });
  const [base, early, late] = sorr(P, YEAR);
  assert.ok(Math.abs(early.final - late.final) < 1e-6, 'without withdrawals, moving the same full-year loss cannot change wealth');
  assert.equal(early.years.at(-1), 32.5);
  assert.equal(base.years.at(-1), 32.5);
  for (const first_month_fraction of [0, 0.25, 0.5]) {
    const partial = sorr({ ...P, first_month_fraction }, YEAR);
    assert.ok(Math.abs(partial[1].final - partial[2].final) < 1e-6, 'partial first months also preserve the total shock duration');
  }
  const short = sorr({ ...P, horizon_months: 366 }, YEAR);
  assert.equal(short[1].final, short[2].final);
});

test('zero-volatility simulations use the same payment ordering, unlock and final-zero criterion as the ledger', async () => {
  const P = plan({ input_mode: 'basic', mode: 'traditional', target_months: 360, horizon_months: 362, assets_cents: 2000, saving_cents: 0, r_before_hundredths: 0, r_after_hundredths: 0, pension_at: () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 }) });
  assert.equal((await monteCarlo(P, 3)).success_rate, 1);
  assert.equal((await monteCarlo(P, 3)).final.p50, 0);
  const short = { ...P, assets_cents: 0, saving_flows: [{ from_month: 360, to_month: 361, cents: -1000, nominal: false, essential: true, timing: 'start' }], spend_flows: [{ from_month: 360, to_month: 361, cents: 1000, nominal: false, essential: true, timing: 'start' }], pension_at: () => ({ monthly_cents: 0, lump_cents: 10000, unlock_age_months: 360 }) };
  assert.equal(outcome(short, project(short, YEAR)).success, false);
  assert.equal((await monteCarlo(short, 3)).success_rate, 0, 'later unlock cannot erase the month-start missed payment');
});

test('income shocks rewrite the saving timeline: halve from a date, or draw down savings for a stretch', () => {
  const P = plan(), N = 360;
  const half = saveFrom(P, N + 36, 0.5);
  assert.deepEqual(half.saving_phases, [{ from_month: N, cents: 1500 }, { from_month: N + 36, cents: 750 }]);
  const gap = gapAt(P, N + 12, 12, -1000);
  assert.deepEqual(gap.saving_phases, [{ from_month: N, cents: 1500 }, { from_month: N + 12, cents: -1000 }, { from_month: N + 24, cents: 1500 }]);
  // 已有的阶段：减半只作用于正数，空窗期的负数保持；缺口之后恢复当时那一段的金额。
  const phased = plan({ saving_phases: [{ from_month: N, cents: -500 }, { from_month: N + 6, cents: 2000 }, { from_month: N + 60, cents: 800 }] });
  assert.deepEqual(saveFrom(phased, N + 36, 0.5).saving_phases, [{ from_month: N, cents: -500 }, { from_month: N + 6, cents: 2000 }, { from_month: N + 36, cents: 1000 }, { from_month: N + 60, cents: 400 }]);
  assert.deepEqual(gapAt(phased, N + 58, 4, 0).saving_phases.map(p => p.cents), [-500, 2000, 0, 800]);
  assert.equal(workSaving(phased), 2000);

});

test('矩阵 uses the working-income saving as its base when phases exist', () => {
  const P = plan({ saving_cents: 0, saving_phases: [{ from_month: 360, cents: -500 }, { from_month: 366, cents: 2000 }] });
  const m = contributionReturnMatrix(P, YEAR);
  assert.equal(m.cols[m.base_col], 2000);
});


test('required saving is the smallest constant monthly amount that reaches the goal, and later plans are kept', () => {
  const base = plan({ r_before_hundredths: 0, r_after_hundredths: 0, pension_at: () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 }), assets_cents: 0, saving_cents: 0, mode: 'traditional', target_months: 480 });
  const need = required(base, 480), s = requiredSaving(base, YEAR, 480);
  // 零收益、没有已有资产：每月至少存「所需 ÷ 月数」，向上取整到分。
  assert.equal(s, Math.ceil(need / 120));
  const reach = v => { const P = { ...base, saving_phases: [{ from_month: 360, cents: v }] }, o = outcome(P, project(P, YEAR)); return o.funded_at_goal; };
  assert.equal(reach(s), true);
  assert.equal(reach(s - 1), false);
  // 手里已经够了：0。存到 100 万一个月也不够：null。
  assert.equal(requiredSaving({ ...base, assets_cents: need + 1 }, YEAR, 480), 0);
  assert.equal(requiredSaving({ ...base, items: [{ ...base.items[0], monthly_cents: 1_000_000_000 }] }, YEAR, 480), null);
  // 只在前 5 年存：之后沿用原来的阶段，所以前期要存得更多。
  const later = { ...base, saving_phases: [{ from_month: 360, cents: 0 }, { from_month: 420, cents: 500 }] };
  const front = requiredSaving(later, YEAR, 420), whole = requiredSaving(later, YEAR, 480);
  assert.ok(front > whole && front > 0);
});

test('basic mode drops the preset career stress cases and keeps the neutral ones', () => {
  const kept = stressTests(plan(), YEAR); const careerStressIds=['income-drop','job-gap','raise-30','raise-double'];
  assert.deepEqual(careerStressIds.slice().sort(), ['income-drop', 'job-gap', 'raise-30', 'raise-double']);
  assert.equal(kept.length, 6);
  for (const id of careerStressIds) assert.equal(kept.some(r => r.id === id), false, id);
  for (const id of ['return-drag', 'inflation-shock', 'spending-shock', 'retire-earlier', 'save-less', 'early-crash']) assert.equal(kept.some(r => r.id === id), true, id);
});
