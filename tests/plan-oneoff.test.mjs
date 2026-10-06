import test from 'node:test';
import assert from 'node:assert/strict';
import { fundsFrom, largeOneOffs, latestHpf, monthlyWithoutOneOffs, savingViews } from '../src/plan.ts';

const line = (source, cents, id = source + cents) => ({ source, id, asset_id: null, title: id, category: null, date: '2026-01-01', amount_cents: cents === null ? null : String(cents) });
const interval = (over = {}) => ({ snapshot_id: 's', from: '2025-06-25', to: '2026-10-04', days: 466, status: 'ok', saving_cents: '4867780', ...over });

test('large one-offs: only purchases and important expenses at or above the threshold, unknown amounts skipped', () => {
  const lines = [line('purchase', 1199900), line('purchase', 19999), line('expense', 5000000), line('payment', 900000), line('sale', 300000), line('maintenance', 500000), line('expense', null, 'x'), line('purchase', 200000, 'edge')];
  assert.deepEqual(largeOneOffs(lines, 200000), { count: 3, total: 1199900n + 5000000n + 200000n });
  assert.deepEqual(largeOneOffs([], 200000), { count: 0, total: 0n });
});

test('the monthly saving without one-offs converts the same period by days, and is null when not comparable', () => {
  const total = 11_000_000n;
  const withOut = monthlyWithoutOneOffs(interval(), total);
  // (储蓄 + 一次性) × 30.4375 ÷ 天数 ≈ 10.9 万…按 466 天折月
  assert.equal(withOut, BigInt(Math.round((4867780 + 11_000_000) * 487 / (16 * 466))));
  assert.ok(withOut > monthlyWithoutOneOffs(interval(), 0n));
  assert.equal(monthlyWithoutOneOffs(interval({ status: 'no_income' }), total), null);
  assert.equal(monthlyWithoutOneOffs(interval({ saving_cents: null }), total), null);
});

test('provident fund monthly uses the latest non-zero row so jobless months recorded as 0 do not erase it', () => {
  const rows = [{ fields: { date: '2026-08-31', hpf_cents: '0' } }, { fields: { date: '2026-09-30', hpf_cents: '0' } }, { fields: { date: '2026-07-31', hpf_cents: '778600' } }, { fields: { date: '2026-06-30', hpf_cents: '700000' } }];
  assert.equal(latestHpf(rows), '778600');
  assert.equal(fundsFrom([], rows).funds.hpf_monthly_cents, '778600');
  const zeros = [{ fields: { date: '2026-08-31', hpf_cents: '0' } }];
  assert.equal(latestHpf(zeros), '0');
  assert.equal(fundsFrom([], zeros).funds.hpf_monthly_cents, '0');
  assert.equal(latestHpf([]), '');
});

test('three saving views: cash flow, free cash and total, from the same interval', () => {
  const i = interval({ days: 487, income_cents: '31214900', hpf_cents: '9343200', delta_nw_cents: '14989600', hpf_change_cents: '6596300', hpf_out_cents: '2746900', saving_cents: '8393300' });
  const [flow, free, total] = savingViews(i);
  assert.deepEqual([flow.id, free.id, total.id], ['cashflow', 'free', 'total']);
  assert.deepEqual([flow.total, free.total, total.total], [14989600n - 9343200n, 8393300n, 14989600n]);
  assert.equal(flow.rate_hundredths, Math.round((5646400 * 10000) / 31214900));
  assert.equal(free.rate_hundredths, Math.round((8393300 * 10000) / (31214900 + 2746900)));
  assert.equal(total.rate_hundredths, Math.round((14989600 * 10000) / (31214900 + 9343200)));
  // 487 天约 16 个月：每月 = 合计 × 487/16 ÷ 487。
  assert.equal(total.monthly, BigInt(Math.round(14989600 * 487 / (16 * 487))));
  // 没有计入公积金账户：只给一行；区间不可比：空。
  assert.deepEqual(savingViews(interval({ days: 100, income_cents: '1000', hpf_cents: '0', delta_nw_cents: '500', hpf_change_cents: null, hpf_out_cents: null, saving_cents: '500' })).map(v => v.id), ['free']);
  assert.deepEqual(savingViews(interval({ status: 'no_income' })), []);
});
