import test from 'node:test';
import assert from 'node:assert/strict';
import { routeById, routeEmployment, routeSavingPhases, routes } from '../src/plan-routes.ts';
import { routeCompare } from '../src/plan-retire-calc.ts';
import { defaultRetire } from '../src/plan.ts';
import { beijing, defaultAssumptions, noOverrides } from '../src/plan-params.ts';

test('the preset routes are internally consistent and inside the Beijing limits', () => {
  assert.equal(new Set(routes.map(r => r.id)).size, routes.length);
  for (const r of routes) {
    assert.ok(r.base_cents >= Number(beijing.base_lower_cents) && r.base_cents <= Number(beijing.base_upper_cents), r.id + ' base');
    assert.ok(r.hpf_cents <= 0.24 * r.base_cents + 1, r.id + ' hpf is at most 12%+12% of the base');
    assert.ok(r.saving_cents > 0 && r.gap_share_hundredths >= 0 && r.gap_share_hundredths <= 5000, r.id);
    assert.ok(r.basis.startsWith('示例假设') || r.basis.startsWith('假设'), r.id + ' is a generic preset');
    assert.ok(!/你/.test(r.basis + r.summary + r.label), r.id + ' carries no personal wording');
  }
  assert.equal(routeById('soe').saving_cents, 800_000);
  assert.equal(routeById(null), null);
  assert.equal(routeById('nope'), null);
});

test('a route replaces the saving phases from its start age; earlier phases stay; its gap share only weighs its own phase', () => {
  const route = { ...routeById('soe'), gap_share_hundredths: 1000 };
  const user = [{ from_month: 340, cents: -600_000 }, { from_month: 360, cents: 1_700_000 }, { from_month: 504, cents: 300_000 }, { from_month: 600, cents: 100_000 }];
  // 42 岁（504 月）起换路线：504 及以后的用户阶段被取代；路线 8000 元按 10% 空窗、生活费 5000 元折算为 6700。
  const out = routeSavingPhases(user, 0, 340, route, 504, 500_000);
  assert.deepEqual(out, [{ from_month: 340, cents: -600_000 }, { from_month: 360, cents: 1_700_000 }, { from_month: 504, cents: 670_000 }]);
  // 没有用户阶段：到换路线之前用盘点中位数。
  assert.deepEqual(routeSavingPhases([], 548_000, 340, route, 420, 500_000), [{ from_month: 340, cents: 548_000 }, { from_month: 420, cents: 670_000 }]);
  // 换路线的年龄不晚于现在：从现在起全程就是路线。
  assert.deepEqual(routeSavingPhases(user, 0, 340, route, 300, 500_000), [{ from_month: 340, cents: 670_000 }]);
});

test('route employment takes the housing fund deposit net of the usual monthly withdrawal, never below zero', () => {
  const soe = routeById('soe');
  assert.deepEqual(routeEmployment(soe, 420, 180_000), [{ from_age_months: 420, base_cents: 1_500_000, hpf_monthly_cents: 360_000 - 180_000 }]);
  assert.equal(routeEmployment(routeById('flex'), 420, 180_000)[0].hpf_monthly_cents, 0);
});

test('comparing routes builds one result per route plus "no route", all from the same inputs', () => {
  const saved = { revision: 1, updated_at: '2026-10-06', profile: {
    birth_month: '1998-06', worker: 'male', region: 'beijing', paid_months: 16, account_balance_cents: '300000', base_cents: '727000', past_index_hundredths: null, flex_months: 0,
    personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000, assumptions: defaultAssumptions, overrides: noOverrides,
    retire: { ...defaultRetire, spend_cents: '500000', target_age: 50 },
  } };
  const snapshot = { entries: [{ counted: true, side: 'asset', kind: 'cash', amount_cents: '11393258' }, { counted: true, side: 'asset', kind: 'housing_fund', amount_cents: '6596322' }] };
  const review = { intervals: [], stats: { median_monthly_saving_cents: '548218', median_monthly_spend_cents: '1670050' } };
  const results = routeCompare(saved, snapshot, review, [], '2026-10-06');
  assert.deepEqual(results.map(r => r.id), [null, 'soe', 'civil', 'tech', 'flex']);
  const fi = id => results.find(r => r.id === id).fi_month;
  // 储蓄最高的路线不会比储蓄最低的更晚财务独立。
  assert.ok((fi('tech') ?? Infinity) <= (fi('flex') ?? Infinity));
  assert.ok(results.every(r => typeof r.label === 'string' && r.label.length > 0));
});
