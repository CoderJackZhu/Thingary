import test from 'node:test';
import assert from 'node:assert/strict';
import { outcome, project, required } from '../src/plan-ledger.ts';
import { monteCarlo } from '../src/plan-risk.ts';

// 全部是虚构计划：单位为分、今天的钱、实际收益 0，数字好手算。每月生活 5000 元 = 500000 分。
const none = () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 100_000 });
const plan = (over = {}) => ({
  now_months: 360, horizon_months: 1080, search_cap_months: 1080, target_months: 360, mode: 'fire', assets_cents: 360_000_000,
  saving_cents: 0, saving_growth_hundredths: 0, r_before_hundredths: 0, r_after_hundredths: 0, inflation_hundredths: 0, volatility_hundredths: 0,
  items: [{ id: 'l', label: '生活', monthly_cents: 500_000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }],
  incomes: [], pension_at: none, spends: [], ...over,
});
const agree = async (P, label) => {
  const o = outcome(P, project(P, 2026)), mc = await monteCarlo(P, 10, { seed: 1 });
  assert.equal(mc.success_rate, o.success ? 1 : 0, label);
  return o;
};

test('a large purchase after retirement raises the amount needed to retire, and one before it does not', () => {
  assert.equal(required(plan(), 360), 360_000_000);
  const buy = plan({ spends: [{ offset_months: 60, cents: 100_000_000 }] });
  assert.equal(required(buy, 360), 460_000_000);
  // 40 岁（第 120 个月）退休时，第 60 个月的支出已经发生，不再计入。
  assert.equal(required(buy, 480), 300_000_000);
  const o = outcome(buy, project(buy, 2026));
  assert.ok(o.fi_month === null || o.fi_month > 360, 'no longer financially independent the day the plan starts');
});

test('a purchase the assets cannot pay stays a debt after retirement instead of being wiped by the next month', async () => {
  // 63 岁、100 万资产，养老金正好付生活费；第 2 个月花 200 万。
  const P = plan({ now_months: 756, horizon_months: 780, target_months: 756, mode: 'traditional', assets_cents: 100_000_000, spends: [{ offset_months: 2, cents: 200_000_000 }],
    pension_at: () => ({ monthly_cents: 500_000, lump_cents: 0, unlock_age_months: 756 }) });
  const proj = project(P, 2026), o = outcome(P, proj);
  assert.ok(proj.assets[proj.assets.length - 1] < 0, 'the shortfall is still there at the end');
  assert.ok(proj.failure_month !== null);
  assert.equal(o.success, false);
  await agree(P, 'debt');
});

test('a debt on the very last month is reported too', () => {
  const P = plan({ now_months: 756, horizon_months: 780, target_months: 756, mode: 'traditional', assets_cents: 100_000_000, spends: [{ offset_months: 24, cents: 200_000_000 }],
    pension_at: () => ({ monthly_cents: 500_000, lump_cents: 0, unlock_age_months: 756 }) });
  assert.equal(project(P, 2026).failure_month, 780);
});

test('simulated success matches the plain calculation, including plans that reached FI but never retired', async () => {
  // 一开始够了，但每月动用存款，到目标年龄已经不够：普通计算判失败，零波动模拟也必须是 0。
  const drained = plan({ target_months: 480, saving_cents: -2_000_000 });
  const o = await agree(drained, 'drained');
  assert.equal(o.fi_month, 360);
  assert.equal(o.retire_month, null);
  for (const mode of ['fire', 'traditional']) for (const assets of [0, 200_000_000, 360_000_000, 900_000_000])
    for (const spends of [[], [{ offset_months: 60, cents: 100_000_000 }], [{ offset_months: 400, cents: 500_000_000 }]])
      await agree(plan({ mode, assets_cents: assets, spends, target_months: 480, saving_cents: 1_000_000 }), `${mode} ${assets} ${spends.length}`);
});
