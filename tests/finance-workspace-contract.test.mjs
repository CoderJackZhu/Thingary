import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financeCapabilities, financePeriodContains, normalizeFinancePeriod, reviewRecordsPeriod } from '../src/finance-contract.ts';
import { availableFinanceRecordTabs, defaultFinanceRecordTab, financeRouteAvailable, legacyFinanceRoute, validFinanceReturn } from '../src/finance-navigation.ts';

const modules = (over = {}) => ({ wealth: false, expenses: false, planning: false, ...over });
const capabilities = (over = {}) => financeCapabilities(modules(over));

test('all, year and month normalize to natural-day boundaries, including early and leap years', () => {
  assert.equal(normalizeFinancePeriod({ kind: 'all' }), null);
  for (const year of [1, 2026, 9999]) {
    const prefix = String(year).padStart(4, '0');
    assert.deepEqual(normalizeFinancePeriod({ kind: 'year', year }), {
      from: `${prefix}-01-01`, to: `${prefix}-12-31`, includeFrom: true,
    });
  }
  for (const [month, last] of [['2024-02', 29], ['2026-02', 28], ['1900-02', 28], ['2000-02', 29], ['2026-04', 30], ['2026-12', 31]]) {
    assert.deepEqual(normalizeFinancePeriod({ kind: 'month', month }), {
      from: `${month}-01`, to: `${month}-${last}`, includeFrom: true,
    });
  }
});

test('malformed or out-of-bounds years, months and known dates are rejected without rolling over', () => {
  for (const year of [0, -1, 10000, 2026.5, NaN, Infinity, '2026']) {
    assert.throws(() => normalizeFinancePeriod({ kind: 'year', year }), RangeError);
    assert.throws(() => legacyFinanceRoute({ kind: 'expenses', year }), RangeError);
  }
  for (const month of ['0000-01', '2026-00', '2026-13', '2026-2', '26-02', '2026-02-01', '2026-02\n']) {
    assert.throws(() => normalizeFinancePeriod({ kind: 'month', month }), RangeError);
  }
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-01-00', '2026-13-01', '0000-01-01', '2026-1-01', '2026-01-1', '2026-01-01T00:00:00Z', '2026-01-01\n', '']) {
    assert.throws(() => financePeriodContains({ kind: 'all' }, date), RangeError);
    assert.throws(() => normalizeFinancePeriod({ kind: 'range', from: date, to: '2026-12-31', includeFrom: true }), RangeError);
    assert.throws(() => normalizeFinancePeriod({ kind: 'range', from: '0001-01-01', to: date, includeFrom: true }), RangeError);
  }
});

test('record periods include both endpoints and support leap day and cross-year ranges', () => {
  const crossYear = { kind: 'range', from: '2025-12-31', to: '2026-01-02', includeFrom: true };
  assert.deepEqual(normalizeFinancePeriod(crossYear), { from: '2025-12-31', to: '2026-01-02', includeFrom: true });
  for (const date of ['2025-12-31', '2026-01-01', '2026-01-02']) assert.equal(financePeriodContains(crossYear, date), true);
  for (const date of ['2025-12-30', '2026-01-03']) assert.equal(financePeriodContains(crossYear, date), false);
  assert.equal(financePeriodContains({ kind: 'month', month: '2024-02' }, '2024-02-29'), true);
  assert.equal(financePeriodContains({ kind: 'year', year: 2026 }, '2026-12-31'), true);
  assert.equal(financePeriodContains({ kind: 'year', year: 2026 }, '2027-01-01'), false);
  assert.equal(financePeriodContains({ kind: 'month', month: '2026-02' }, '2026-03-01'), false);
  assert.equal(financePeriodContains({ kind: 'all' }, '0001-01-01'), true);
  assert.equal(financePeriodContains({ kind: 'all' }, '9999-12-31'), true);
  const sameDay = { kind: 'range', from: '2026-10-01', to: '2026-10-01', includeFrom: true };
  assert.equal(financePeriodContains(sameDay, '2026-10-01'), true);
});

test('review drilldown preserves (opening day, closing day] and never assigns unknown dates', () => {
  const period = reviewRecordsPeriod('2026-09-30', '2026-10-31');
  assert.deepEqual(period, { kind: 'range', from: '2026-09-30', to: '2026-10-31', includeFrom: false });
  assert.equal(financePeriodContains(period, '2026-09-30'), false);
  for (const date of ['2026-10-01', '2026-10-31']) assert.equal(financePeriodContains(period, date), true);
  assert.equal(financePeriodContains(period, '2026-11-01'), false);
  for (const candidate of [{ kind: 'all' }, { kind: 'year', year: 2026 }, { kind: 'month', month: '2026-10' }, period]) {
    assert.equal(financePeriodContains(candidate, null), false);
  }
  assert.equal(financePeriodContains(reviewRecordsPeriod('2024-02-28', '2024-03-01'), '2024-02-29'), true);
  for (const [from, to] of [['2026-10-01', '2026-10-01'], ['2026-10-02', '2026-10-01']]) {
    assert.throws(() => reviewRecordsPeriod(from, to), RangeError);
    assert.throws(() => normalizeFinancePeriod({ kind: 'range', from, to, includeFrom: false }), RangeError);
  }
  assert.throws(() => normalizeFinancePeriod({ kind: 'range', from: '2026-10-02', to: '2026-10-01', includeFrom: true }), RangeError);
});

test('legacy defaults keep disabled facts closed while wealth review and manual review stay independent', () => {
  assert.deepEqual(capabilities({ wealth: true }), {
    accounts: true, incomeRecords: false, expenseRecords: false, movementRecords: false,
    review: true, goals: false, manualInvestmentReview: true, movementInvestmentReview: false,
  });
  const enabledFacts = capabilities({ wealth: true, incomes: true, movements: true });
  assert.equal(enabledFacts.incomeRecords, true);
  assert.equal(enabledFacts.movementRecords, true);
  assert.equal(enabledFacts.movementInvestmentReview, true);
  assert.equal(enabledFacts.goals, false);
  const withoutAccounts = capabilities({ incomes: true, movements: true });
  assert.equal(withoutAccounts.incomeRecords, true);
  for (const key of ['accounts', 'movementRecords', 'review', 'manualInvestmentReview', 'movementInvestmentReview']) assert.equal(withoutAccounts[key], false);
  const explicitOff = capabilities({ wealth: true, planning: true, incomes: false, movements: false });
  assert.equal(explicitOff.incomeRecords, false);
  assert.equal(explicitOff.movementRecords, false);
  assert.equal(explicitOff.goals, true);
  const inherited = capabilities({ wealth: true, planning: true });
  assert.equal(inherited.incomeRecords, true);
  assert.equal(inherited.movementRecords, true);
});

test('every explicit capability combination filters record tabs in fixed order', () => {
  for (const wealth of [false, true]) for (const expenses of [false, true]) for (const planning of [false, true]) for (const incomes of [false, true]) for (const movements of [false, true]) {
    const input = { wealth, expenses, planning, incomes, movements };
    const before = { ...input };
    const caps = financeCapabilities(input);
    const expected = [...(incomes ? ['income'] : []), ...(expenses ? ['expenses'] : []), ...(wealth && movements ? ['movements'] : [])];
    assert.deepEqual(availableFinanceRecordTabs(caps), expected);
    assert.equal(defaultFinanceRecordTab(caps), expected[0] ?? null);
    for (const preferred of ['income', 'expenses', 'movements']) {
      assert.equal(defaultFinanceRecordTab(caps, preferred), expected.includes(preferred) ? preferred : expected[0] ?? null);
      assert.equal(financeRouteAvailable({ page: 'records', tab: preferred }, caps), expected.includes(preferred));
    }
    assert.equal(financeRouteAvailable({ page: 'review', view: 'period' }, caps), wealth);
    assert.equal(financeRouteAvailable({ page: 'review', view: 'compare' }, caps), wealth);
    assert.equal(financeRouteAvailable({ page: 'goals' }, caps), planning);
    assert.deepEqual(input, before, 'derivation must not write module preferences');
  }
});

test('an explicit disabled source route is unavailable even when a fallback tab exists', () => {
  const caps = capabilities({ expenses: true });
  const route = { page: 'records', tab: 'income', source: { kind: 'income', id: 'fictional-income-1' } };
  const before = structuredClone(route);
  assert.equal(defaultFinanceRecordTab(caps, 'income'), 'expenses');
  assert.equal(financeRouteAvailable(route, caps), false);
  assert.deepEqual(route, before);
  assert.equal(financeRouteAvailable({ ...route, tab: 'expenses' }, caps), true, 'source metadata does not grant or remove page capability');
  assert.deepEqual(availableFinanceRecordTabs(capabilities()), []);
  assert.equal(defaultFinanceRecordTab(capabilities(), 'income'), null);
});

test('all legacy entry intents map without fabricated IDs or goals becoming income', () => {
  for (const intent of [{ kind: 'expenses' }, { kind: 'expenses', year: null }]) {
    assert.deepEqual(legacyFinanceRoute(intent), { page: 'records', tab: 'expenses', period: { kind: 'all' } });
  }
  assert.deepEqual(legacyFinanceRoute({ kind: 'expenses', year: 2026 }), { page: 'records', tab: 'expenses', period: { kind: 'year', year: 2026 } });
  assert.deepEqual(legacyFinanceRoute({ kind: 'planning-income' }), { page: 'records', tab: 'income' });
  assert.deepEqual(legacyFinanceRoute({ kind: 'planning-review' }), { page: 'review', view: 'period' });
  assert.deepEqual(legacyFinanceRoute({ kind: 'planning-review', toSnapshotId: 'fictional-closing' }), { page: 'review', view: 'period', toSnapshotId: 'fictional-closing' });
  assert.deepEqual(legacyFinanceRoute({ kind: 'wealth-changes' }), { page: 'review', view: 'compare' });
  const pair = { fromSnapshotId: 'fictional-first', toSnapshotId: 'fictional-last' };
  assert.deepEqual(legacyFinanceRoute({ kind: 'wealth-changes', pair }), { page: 'review', view: 'compare', pair });
  for (const [kind, importKind] of [['financial-import', 'finance'], ['item-import', 'items']]) {
    assert.deepEqual(legacyFinanceRoute({ kind }), { page: 'data-management', importKind });
  }
  assert.deepEqual(legacyFinanceRoute({ kind: 'export' }), { page: 'data-management' });
  assert.deepEqual(legacyFinanceRoute({ kind: 'goals' }), { page: 'goals' });
});

test('return context retains exact period, account scope and browsing state only in the same available library', () => {
  const context = {
    generation: 'fictional-library-a',
    route: { page: 'records', tab: 'movements', period: reviewRecordsPeriod('2026-09-30', '2026-10-31'), source: { kind: 'movement', id: 'fictional-movement-1' }, movementAccountIds: ['fictional-investment-1'] },
    scroll: 420, search: '虚构来源', sort: 'date-desc', expandedIds: ['fictional-movement-1'],
  };
  const caps = capabilities({ wealth: true, movements: true });
  assert.strictEqual(validFinanceReturn(context, context.generation, caps), context);
  assert.equal(validFinanceReturn(context, 'fictional-library-b', caps), null);
  assert.equal(validFinanceReturn(context, context.generation, capabilities({ wealth: true })), null);
  assert.equal(validFinanceReturn(context, context.generation, capabilities({ movements: true })), null);
  assert.equal(validFinanceReturn(null, context.generation, caps), null);
  const review = { ...context, route: { page: 'review', view: 'period', pair: { fromSnapshotId: 'fictional-first', toSnapshotId: 'fictional-last' }, investmentAccountIds: ['fictional-investment-1'] } };
  assert.strictEqual(validFinanceReturn(review, context.generation, capabilities({ wealth: true })), review);
  assert.equal(validFinanceReturn(review, context.generation, capabilities()), null);
  const goal = { ...context, route: { page: 'goals' } };
  assert.equal(validFinanceReturn(goal, context.generation, caps), null);
});

test('data management stays reachable for recovery with all finance modules disabled', () => {
  for (const route of [{ page: 'data-management' }, { page: 'data-management', importKind: 'finance' }, { page: 'data-management', importKind: 'items' }]) {
    assert.equal(financeRouteAvailable(route, capabilities()), true);
    const context = { generation: 'fictional-library-a', route, scroll: 12 };
    assert.strictEqual(validFinanceReturn(context, context.generation, capabilities()), context);
    assert.equal(validFinanceReturn(context, 'fictional-library-b', capabilities()), null);
  }
});
