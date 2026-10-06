import test from 'node:test';
import assert from 'node:assert/strict';
import { annuity, emergency, findFire, pensionTable, requiredAssets, sensitivity, traditional } from '../src/plan-fire.ts';
import { beijing } from '../src/plan-params.ts';

const none = () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 });
const ledger = (over = {}) => ({ now_months: 360, horizon_months: 1080, search_cap_months: 840, spend_cents: 1000, assets_cents: 0, pension_at: none, ...over });

test('annuity factor: zero rate is the number of months, otherwise the closed form', () => {
  assert.equal(annuity(360, 0), 360);
  assert.equal(annuity(0, 0.01), 0);
  const i = 0.004;
  let loop = 0;
  for (let k = 1; k <= 120; k++) loop += (1 + i) ** -k;
  assert.ok(Math.abs(annuity(120, i) - loop) < 1e-9);
});

test('required assets at zero return: spending minus pension minus the lump sum', () => {
  // 60 岁辞职、90 岁为终点：360 个月；63 岁（再过 36 个月）起每月领 400，解锁 5000。
  const L = ledger({ pension_at: () => ({ monthly_cents: 400, lump_cents: 5000, unlock_age_months: 756 }) });
  assert.equal(requiredAssets(L, 720, 0), 1000 * 360 - 400 * (360 - 36) - 5000);
  // 没有养老金：就是支出总额；资产够多时下限为 0。
  assert.equal(requiredAssets(ledger(), 720, 0), 360_000);
  assert.equal(requiredAssets(ledger({ pension_at: () => ({ monthly_cents: 1e9, lump_cents: 0, unlock_age_months: 720 }) }), 720, 0), 0);
  // 已过规划终点：不需要资产。
  assert.equal(requiredAssets(ledger(), 1080, 0), 0);
});

test('required assets with a positive return are smaller and match a month-by-month sum', () => {
  const L = ledger({ pension_at: () => ({ monthly_cents: 400, lump_cents: 5000, unlock_age_months: 756 }) });
  const r = 200, i = (1 + 0.02) ** (1 / 12) - 1;
  let pv = 0;
  for (let k = 1; k <= 360; k++) pv += (1000 - (k > 36 ? 400 : 0)) * (1 + i) ** -k;
  pv -= 5000 * (1 + i) ** -36;
  assert.ok(Math.abs(requiredAssets(L, 720, r) - pv) < 1e-6);
  assert.ok(requiredAssets(L, 720, r) < requiredAssets(L, 720, 0));
});

test('FIRE date: first month assets reach the required amount', () => {
  // 现在 30 岁、无养老金、每月支出 1000、每月存 1000、零收益：t ≥ 1000·(720 − t)/1000 → t = 360。
  const fire = findFire(ledger(), 1000, 0, 0);
  assert.deepEqual([fire.offset_months, fire.age_months, fire.required_cents, fire.assets_cents], [360, 720, 360_000, 360_000]);
  // 已经够了：当月就是 FIRE 日期。
  assert.equal(findFire(ledger({ assets_cents: 1e9 }), 0, 0, 0).offset_months, 0);
  // 不存钱、资产不够：不可达，不给假日期。
  assert.equal(findFire(ledger({ assets_cents: 10 }), 0, 0, 0), null);
  // 搜索上限：存得太慢，超过 70 岁就是不可达。
  assert.equal(findFire(ledger({ search_cap_months: 480 }), 1000, 0, 0), null);
});

test('a pension and unlocked funds bring the FIRE date forward', () => {
  const withPension = ledger({ pension_at: () => ({ monthly_cents: 600, lump_cents: 50_000, unlock_age_months: 756 }) });
  assert.ok(findFire(withPension, 1000, 0, 0).offset_months < findFire(ledger(), 1000, 0, 0).offset_months);
});

test('traditional mode reports surplus or shortfall at the statutory start age', () => {
  const t = traditional(ledger({ assets_cents: 5000 }), 756, 1000, 0, 0);
  // 现在 30 岁、63 岁领取：396 个月，资产 5000 + 396 × 1000；需要 (1080 − 756) × 1000。
  assert.deepEqual([t.age_months, t.assets_cents, t.required_cents, t.surplus_cents], [756, 401_000, 324_000, 77_000]);
  assert.equal(traditional(ledger(), 756, 100, 0, 0).surplus_cents < 0, true);
});

test('sensitivity: more saving or a higher return never delays FIRE; unreachable cells are null', () => {
  const L = ledger({ assets_cents: 100_000 });
  const s = sensitivity(L, 1000);
  assert.equal(s.cells.length, 7);
  assert.equal(s.cells[0].length, 5);
  const age = c => c ?? Infinity;
  for (let r = 0; r < 7; r++) for (let c = 1; c < 5; c++) assert.ok(age(s.cells[r][c]) <= age(s.cells[r][c - 1]), 'higher return');
  for (let c = 0; c < 5; c++) for (let r = 1; r < 7; r++) assert.ok(age(s.cells[r][c]) <= age(s.cells[r - 1][c]), 'more saving');
  // 中间行（100% 储蓄、0% 收益）就是主结果。
  assert.equal(s.cells[3][0], findFire(L, 1000, 0, 0).age_months);
  assert.equal(sensitivity(ledger(), 0).cells[0][0], null);
});

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
  const base = { now_months: 436, horizon_months: 1080, search_cap_months: 840, spend_cents: 800_000, assets_cents: 30_000_000 };
  const withFunds = findFire({ ...base, pension_at: at }, 600_000, 0, 0);
  const without = findFire({ ...base, pension_at: none }, 600_000, 0, 0);
  assert.ok(withFunds.offset_months <= without.offset_months);
});
