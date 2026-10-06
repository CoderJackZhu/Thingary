import test from 'node:test';
import assert from 'node:assert/strict';
import { fundsFrom, largeOneOffs, latestHpf, monthlyWithoutOneOffs } from '../src/plan.ts';

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
